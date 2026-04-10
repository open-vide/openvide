/**
 * HTTP(S) + WebSocket bridge server, embedded in the daemon process.
 * Zero external dependencies — uses node:http, node:https, node:net, node:crypto, node:fs.
 *
 * Port from apps/bridge/http-bridge.ts with key changes:
 * - sendToSocket() → routeCommand() (direct in-process call)
 * - Static token → JWT (HMAC-SHA256)
 * - Config from DaemonState.bridge
 */

import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { verifyJwt } from "./jwt.js";
import { detectTailscaleIp, detectTailscaleHostname, getTailscaleTls } from "./certs.js";
import { routeCommand } from "./ipc.js";
import { handleCompletions, handleCompletionsStreaming } from "./completions.js";
import { daemonDir, log, logError } from "./utils.js";
import type { BridgeConfig } from "./types.js";
import { registerTeamBroadcast } from "./teamManager.js";
import { persist } from "./sessionManager.js";
import {
  authenticateBridgeToken,
  createBridgeClientSession,
  refreshBridgeClientSession,
  revokeBridgeClientSession,
  type BridgeAuthMeta,
} from "./bridgeAuth.js";

const SESSIONS_DIR = path.join(daemonDir(), "sessions");
const WS_MAGIC = "258EAFA5-E914-47DA-95CA-5AB5BE86B57E";
const BRIDGE_VERSION = "3.0.0";

// ── State ──

let server: http.Server | https.Server | null = null;
let activeConfig: BridgeConfig | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

interface WsClient {
  socket: net.Socket;
  id: string;
  subscriptions: Map<string, ReturnType<typeof setInterval>>;
  alive: boolean;
}

const clients = new Map<string, WsClient>();

// ── Auth ──

function checkJwt(req: http.IncomingMessage): boolean {
  if (!activeConfig) return false;
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  return authenticateBridgeToken(activeConfig, token) !== null;
}

function checkJwtFromUrl(url: URL): boolean {
  if (!activeConfig) return false;
  const token = url.searchParams.get("token");
  if (!token) return false;
  return authenticateBridgeToken(activeConfig, token) !== null;
}

// ── Helpers ──

function cors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function bearerToken(req: http.IncomingMessage): string | null {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

function requestAuthMeta(req: http.IncomingMessage): BridgeAuthMeta {
  return {
    ip: req.socket.remoteAddress ?? undefined,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1_048_576) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  return JSON.parse(body) as Record<string, unknown>;
}

// ── WebSocket Implementation (RFC 6455) ──

function acceptWebSocket(
  req: http.IncomingMessage,
  socket: net.Socket,
  head: Buffer,
): WsClient | null {
  const wsKey = req.headers["sec-websocket-key"];
  if (!wsKey) return null;

  const acceptHash = crypto
    .createHash("sha1")
    .update(wsKey + WS_MAGIC)
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${acceptHash}\r\n` +
    "\r\n",
  );

  const clientId = crypto.randomUUID();
  const client: WsClient = {
    socket,
    id: clientId,
    subscriptions: new Map(),
    alive: true,
  };

  clients.set(clientId, client);

  if (head.length > 0) {
    processWsFrames(client, head);
  }

  let buffer: Buffer<ArrayBuffer> = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]) as Buffer<ArrayBuffer>;
    buffer = processWsFrames(client, buffer) as Buffer<ArrayBuffer>;
  });

  socket.on("close", () => cleanupClient(client));
  socket.on("error", () => cleanupClient(client));

  log(`[bridge:ws] Client connected: ${clientId}, total: ${clients.size}`);
  return client;
}

function processWsFrames(client: WsClient, buffer: Buffer): Buffer {
  while (buffer.length >= 2) {
    const firstByte = buffer[0]!;
    const secondByte = buffer[1]!;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLen = secondByte & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (buffer.length < 4) break;
      payloadLen = buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (buffer.length < 10) break;
      payloadLen = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }

    const maskSize = masked ? 4 : 0;
    const totalLen = offset + maskSize + payloadLen;
    if (buffer.length < totalLen) break;

    let payload = buffer.subarray(offset + maskSize, totalLen);

    if (masked) {
      const mask = buffer.subarray(offset, offset + 4);
      const unmasked = Buffer.from(payload);
      for (let i = 0; i < unmasked.length; i++) {
        unmasked[i] = (unmasked[i]! ^ mask[i % 4]!) as number & 0xff;
      }
      payload = unmasked;
    }

    buffer = buffer.subarray(totalLen);

    if (opcode === 0x08) {
      sendWsFrame(client, Buffer.alloc(0), 0x08);
      client.socket.end();
      cleanupClient(client);
      return Buffer.alloc(0);
    } else if (opcode === 0x09) {
      sendWsFrame(client, payload, 0x0a);
    } else if (opcode === 0x0a) {
      client.alive = true;
    } else if (opcode === 0x01) {
      handleWsMessage(client, payload.toString("utf-8"));
    }
  }

  return buffer;
}

function sendWsFrame(client: WsClient, data: Buffer | string, opcode = 0x01): void {
  const payload = typeof data === "string" ? Buffer.from(data) : data;
  const len = payload.length;
  let header: Buffer;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  try {
    client.socket.write(Buffer.concat([header, payload]));
  } catch {
    cleanupClient(client);
  }
}

function sendWsJson(client: WsClient, data: unknown): void {
  sendWsFrame(client, JSON.stringify(data));
}

function cleanupClient(client: WsClient): void {
  if (!clients.has(client.id)) return;
  for (const [, interval] of client.subscriptions) {
    clearInterval(interval);
  }
  client.subscriptions.clear();
  clients.delete(client.id);
  log(`[bridge:ws] Client disconnected: ${client.id}, remaining: ${clients.size}`);
}

// ── WebSocket Message Handling ──

/** Broadcast an event to ALL connected WS clients. */
function broadcastToClients(event: Record<string, unknown>): void {
  for (const [, client] of clients) {
    sendWsJson(client, event);
  }
}

async function handleWsMessage(client: WsClient, raw: string): Promise<void> {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    sendWsJson(client, { error: "Invalid JSON" });
    return;
  }

  const id = msg.id as number | undefined;
  const cmd = msg.cmd as string | undefined;

  // Handle pong from client
  if (msg.type === "pong") {
    client.alive = true;
    return;
  }

  if (!cmd) {
    sendWsJson(client, { id, ok: false, error: 'Missing "cmd"' });
    return;
  }

  if (cmd === "subscribe") {
    const sessionId = msg.sessionId as string;
    if (!sessionId) {
      sendWsJson(client, { id, ok: false, error: "Missing sessionId" });
      return;
    }
    subscribeOutput(client, sessionId);
    sendWsJson(client, { id, ok: true });
    return;
  }

  if (cmd === "unsubscribe") {
    const sessionId = msg.sessionId as string;
    if (!sessionId) {
      sendWsJson(client, { id, ok: false, error: "Missing sessionId" });
      return;
    }
    unsubscribeOutput(client, sessionId);
    sendWsJson(client, { id, ok: true });
    return;
  }

  // Regular RPC → routeCommand (in-process)
  try {
    const { cmd: _cmd, id: _id, ...params } = msg;
    const result = await routeCommand({ cmd, ...params });
    sendWsJson(client, { id, ...result });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Bridge error";
    sendWsJson(client, { id, ok: false, error: errMsg });
  }
}

// ── Output Subscription (file polling) ──

function subscribeOutput(client: WsClient, sessionId: string): void {
  unsubscribeOutput(client, sessionId);

  const outputPath = path.join(SESSIONS_DIR, sessionId, "output.jsonl");
  let byteOffset = 0;

  try {
    if (fs.existsSync(outputPath)) {
      const existing = fs.readFileSync(outputPath, "utf-8");
      byteOffset = Buffer.byteLength(existing, "utf-8");
      const lines = existing.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        sendWsJson(client, { type: "output", sessionId, line });
      }
    }
  } catch {
    // File might not exist yet
  }

  const interval = setInterval(() => {
    if (!clients.has(client.id)) {
      clearInterval(interval);
      return;
    }
    try {
      const stat = fs.statSync(outputPath);
      if (stat.size > byteOffset) {
        const fd = fs.openSync(outputPath, "r");
        const buf = Buffer.alloc(stat.size - byteOffset);
        fs.readSync(fd, buf, 0, buf.length, byteOffset);
        fs.closeSync(fd);
        byteOffset = stat.size;

        const newData = buf.toString("utf-8");
        const lines = newData.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          sendWsJson(client, { type: "output", sessionId, line });
        }
      }
    } catch {
      // File may have been removed
    }
  }, 250);

  client.subscriptions.set(sessionId, interval);
  log(`[bridge:ws] Client ${client.id} subscribed to session ${sessionId}`);
}

function unsubscribeOutput(client: WsClient, sessionId: string): void {
  const existing = client.subscriptions.get(sessionId);
  if (existing) {
    clearInterval(existing);
    client.subscriptions.delete(sessionId);
  }
}

// ── SSE Streaming ──

function streamSessionOutputSSE(sessionId: string, res: http.ServerResponse): void {
  const outputPath = path.join(SESSIONS_DIR, sessionId, "output.jsonl");

  cors(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  let byteOffset = 0;
  try {
    if (fs.existsSync(outputPath)) {
      const existing = fs.readFileSync(outputPath, "utf-8");
      byteOffset = Buffer.byteLength(existing, "utf-8");
      const lines = existing.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        res.write(`data: ${line}\n\n`);
      }
    }
  } catch { /* ignore */ }

  let watching = true;
  const pollInterval = setInterval(() => {
    if (!watching) return;
    try {
      const stat = fs.statSync(outputPath);
      if (stat.size > byteOffset) {
        const fd = fs.openSync(outputPath, "r");
        const buf = Buffer.alloc(stat.size - byteOffset);
        fs.readSync(fd, buf, 0, buf.length, byteOffset);
        fs.closeSync(fd);
        byteOffset = stat.size;
        const newData = buf.toString("utf-8");
        const lines = newData.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          res.write(`data: ${line}\n\n`);
        }
      }
    } catch { /* ignore */ }
  }, 250);

  res.on("close", () => {
    watching = false;
    clearInterval(pollInterval);
  });
}

// ── HTTP Request Handler ──

const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
  const t0 = Date.now();
  const from = `${req.socket.remoteAddress}`;
  log(`[bridge:http] ${req.method} ${req.url} from ${from}`);

  // CORS preflight
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const port = activeConfig?.port ?? 7842;
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  if (url.pathname === "/api/auth/session" && req.method === "POST") {
    if (!activeConfig) {
      json(res, 500, { ok: false, error: "Bridge not configured" });
      return;
    }
    const token = bearerToken(req);
    if (!token) {
      json(res, 401, { ok: false, error: "Missing bridge token" });
      return;
    }
    const auth = authenticateBridgeToken(activeConfig, token);
    if (!auth || (auth.kind !== "legacy" && auth.kind !== "bootstrap")) {
      json(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }
    const session = createBridgeClientSession(activeConfig, requestAuthMeta(req));
    persist();
    json(res, 200, { ok: true, authSession: session });
    return;
  }

  if (url.pathname === "/api/auth/refresh" && req.method === "POST") {
    if (!activeConfig) {
      json(res, 500, { ok: false, error: "Bridge not configured" });
      return;
    }
    try {
      const parsed = await readJsonBody(req);
      const refreshToken = typeof parsed.refreshToken === "string" ? parsed.refreshToken : "";
      if (!refreshToken) {
        json(res, 400, { ok: false, error: "Missing refreshToken" });
        return;
      }
      const session = refreshBridgeClientSession(activeConfig, refreshToken, requestAuthMeta(req));
      if (!session) {
        json(res, 401, { ok: false, error: "Invalid refresh session" });
        return;
      }
      persist();
      json(res, 200, { ok: true, authSession: session });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid request";
      json(res, 400, { ok: false, error: msg });
    }
    return;
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    if (!activeConfig) {
      json(res, 500, { ok: false, error: "Bridge not configured" });
      return;
    }
    try {
      const parsed: Record<string, unknown> = await readJsonBody(req).catch(() => ({}));
      const refreshToken = typeof parsed.refreshToken === "string" ? parsed.refreshToken : "";
      let sessionId: string | null = null;
      if (refreshToken) {
        const dot = refreshToken.indexOf(".");
        if (dot > 0) sessionId = refreshToken.slice(0, dot);
      }
      if (!sessionId) {
        const token = bearerToken(req);
        if (token) {
          const auth = authenticateBridgeToken(activeConfig, token);
          if (auth?.kind === "access") {
            sessionId = auth.session.id;
          }
        }
      }
      if (!sessionId) {
        json(res, 400, { ok: false, error: "Missing bridge session" });
        return;
      }
      revokeBridgeClientSession(activeConfig, sessionId);
      persist();
      json(res, 200, { ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid request";
      json(res, 400, { ok: false, error: msg });
    }
    return;
  }

  // Health check — GET /api/host
  if (url.pathname === "/api/host" && req.method === "GET") {
    if (!checkJwt(req) && !checkJwtFromUrl(url)) {
      json(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }
    json(res, 200, {
      ok: true,
      name: os.hostname(),
      version: BRIDGE_VERSION,
      tls: activeConfig?.tls ?? false,
      ws: true,
    });
    return;
  }

  // RPC endpoint — POST /api/rpc
  if (url.pathname === "/api/rpc" && req.method === "POST") {
    if (!checkJwt(req)) {
      json(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      if (!parsed.cmd) {
        json(res, 400, { ok: false, error: 'Missing "cmd" field' });
        return;
      }
      const result = await routeCommand(parsed);
      json(res, 200, result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bridge error";
      json(res, 502, { ok: false, error: msg });
    }
    return;
  }

  // SSE stream — GET /api/sessions/{id}/stream
  const streamMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
  if (streamMatch && req.method === "GET") {
    if (!checkJwt(req) && !checkJwtFromUrl(url)) {
      json(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }
    streamSessionOutputSSE(streamMatch[1]!, res);
    return;
  }

  // OpenAI-compatible completions
  // POST /v1/chat/completions         → uses bridge.evenAiTool config (default: claude)
  // POST /v1/chat/completions/claude   → forces claude
  // POST /v1/chat/completions/codex    → forces codex
  // POST /v1/chat/completions/gemini   → forces gemini
  const completionsMatch = url.pathname.match(/^\/v1\/chat\/completions(?:\/(claude|codex|gemini))?$/);
  if (completionsMatch && req.method === "POST") {
    if (!checkJwt(req)) {
      json(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const toolOverride = completionsMatch[1] as "claude" | "codex" | "gemini" | undefined;
      await handleCompletionsRequest(parsed, toolOverride, res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Internal error";
      json(res, 500, { ok: false, error: msg });
    }
    return;
  }

  json(res, 404, { ok: false, error: "Not found" });
};

// ── Request dedup ──
// Even AI sends duplicate requests. Drop the second one within a short window.
let lastCompletionsPrompt = "";
let lastCompletionsTime = 0;
const DEDUP_WINDOW_MS = 3000;

async function handleCompletionsRequest(
  parsed: Record<string, unknown>,
  toolOverride: "claude" | "codex" | "gemini" | undefined,
  res: http.ServerResponse,
): Promise<void> {
  if (!activeConfig) {
    json(res, 500, { ok: false, error: "Bridge not configured" });
    return;
  }

  // Extract prompt for dedup check
  const messages = parsed.messages as unknown[];
  let prompt = "";
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as Record<string, unknown>;
      if (m.role === "user" && typeof m.content === "string") {
        prompt = m.content;
        break;
      }
    }
  }

  // Drop duplicate requests
  const now = Date.now();
  if (prompt && prompt === lastCompletionsPrompt && (now - lastCompletionsTime) < DEDUP_WINDOW_MS) {
    log(`[bridge:completions] Dedup: dropping duplicate request`);
    json(res, 200, {
      id: "chatcmpl-dedup",
      object: "chat.completion",
      created: Math.floor(now / 1000),
      model: "claude",
      choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    return;
  }
  lastCompletionsPrompt = prompt;
  lastCompletionsTime = now;

  // Tool is determined by path, not by model field in body
  const tool = toolOverride ?? activeConfig.evenAiTool ?? "claude";
  const stream = parsed.stream === true;
  log(
    `[bridge:completions] tool=${tool} override=${toolOverride ?? "none"} stream=${stream} messages=${Array.isArray(parsed.messages) ? parsed.messages.length : 0} promptChars=${prompt.length}`,
  );

  if (stream) {
    await handleCompletionsStreaming(parsed, activeConfig, res, tool);
  } else {
    const result = await handleCompletions(parsed, activeConfig, tool);
    const choices = Array.isArray(result.choices) ? result.choices.length : 0;
    log(`[bridge:completions] completed tool=${tool} choices=${choices}`);
    json(res, 200, result);
  }
}

// ── WebSocket Upgrade Handler ──

function handleUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
  const port = activeConfig?.port ?? 7842;
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  if (url.pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!checkJwtFromUrl(url)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  acceptWebSocket(req, socket, head);
}

// ── Public API ──

export function startBridge(config: BridgeConfig): void {
  // Set config FIRST — stopBridge's async callback must not null it
  activeConfig = config;

  if (server) {
    log("[bridge] Already running, stopping first...");
    // Synchronously clean up without nulling activeConfig
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
    for (const [, client] of clients) {
      for (const [, interval] of client.subscriptions) clearInterval(interval);
      client.subscriptions.clear();
      try { client.socket.destroy(); } catch { /* ignore */ }
    }
    clients.clear();
    try { server.close(); } catch { /* ignore */ }
    server = null;
  }

  registerTeamBroadcast(broadcastToClients);

  // Try Tailscale HTTPS cert (trusted Let's Encrypt), fall back to HTTP
  const tsTls = getTailscaleTls();
  if (tsTls) {
    server = https.createServer({ cert: tsTls.cert, key: tsTls.key }, requestHandler);
  } else {
    server = http.createServer(requestHandler);
  }

  server.on("upgrade", handleUpgrade);

  server.on("error", (err: Error) => {
    logError("[bridge] Server error:", err.message);
  });

  const bindHost = config.bindHost?.trim() || "::";
  const tsIp = detectTailscaleIp();
  const tsHostname = tsTls?.hostname;

  server.listen(config.port, bindHost, () => {
    const proto = tsTls ? "HTTPS" : "HTTP";
    log(`[bridge] ${proto}+WebSocket bridge listening on ${bindHost}:${config.port}`);
    if (tsHostname) {
      log(`[bridge] Tailscale HTTPS: https://${tsHostname}:${config.port}`);
    } else if (tsIp) {
      log(`[bridge] Tailscale: http://${tsIp}:${config.port}`);
    }
  });

  // Keepalive ping every 30s
  keepaliveTimer = setInterval(() => {
    for (const [, client] of clients) {
      if (!client.alive) {
        client.socket.destroy();
        cleanupClient(client);
        continue;
      }
      client.alive = false;
      sendWsJson(client, { type: "ping" });
    }
  }, 30_000);
}

export function stopBridge(): Promise<void> {
  return new Promise((resolve) => {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }

    // Cleanup all WS clients
    for (const [, client] of clients) {
      for (const [, interval] of client.subscriptions) {
        clearInterval(interval);
      }
      client.subscriptions.clear();
      try { client.socket.destroy(); } catch { /* ignore */ }
    }
    clients.clear();

    if (!server) {
      resolve();
      return;
    }

    server.close(() => {
      server = null;
      activeConfig = null;
      log("[bridge] Stopped");
      resolve();
    });

    // Force close after 3s
    setTimeout(() => {
      if (server) {
        server = null;
        activeConfig = null;
      }
      resolve();
    }, 3000);
  });
}

export function isBridgeRunning(): boolean {
  return server !== null && server.listening;
}

export function getBridgeInfo(): {
  enabled: boolean;
  port: number;
  tls: boolean;
  bindHost: string;
  connections: number;
} {
  return {
    enabled: isBridgeRunning(),
    port: activeConfig?.port ?? 7842,
    tls: activeConfig?.tls ?? false,
    bindHost: activeConfig?.bindHost?.trim() || "::",
    connections: clients.size,
  };
}

/** Update the active config without restarting. Used when bridge.config changes runtime settings. */
export function updateBridgeConfig(config: BridgeConfig): void {
  activeConfig = config;
}

/** Get the LAN IP address for QR code generation. */
export function getLocalIp(): string {
  const ifaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "localhost";
}
