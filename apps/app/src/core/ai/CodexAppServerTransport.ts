import { describeCommandIntent, getCommandIntentKey } from "./commandIntent";
import { sanitizeCodexToolOutput } from "./codexOutputSanitizer";
import { NativeSshClient, type SshLocalPortForward } from "../ssh/nativeSsh";
import type { SshCredentials, TargetProfile } from "../types";
import type { CliStreamEvent } from "./adapterTypes";
import type { CodexModelInfo, SessionHistoryPayload, WorkspaceChatInfo } from "./DaemonTransport";

interface JsonRpcPending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface AppServerConnection {
  targetId: string;
  remotePort: number;
  socket: WebSocket;
  serverPid?: number;
  serverLogPath: string;
  serverPidPath: string;
  tunnel: SshLocalPortForward;
  nextId: number;
  pending: Map<number, JsonRpcPending>;
  listeners: Set<(message: Record<string, unknown>) => void>;
}

interface CodexThreadRecord {
  id: string;
  cwd?: string;
  path?: string;
  preview?: string;
  name?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: {
    type?: string;
  };
}

const CODEX_START_RESULT_BEGIN = "__OV_CODEX_START_RESULT_BEGIN__";
const CODEX_START_RESULT_END = "__OV_CODEX_START_RESULT_END__";

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function stripAnsi(text: string): string {
  return text
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, "")
    .replace(/\[(?:\d{1,4}(?:;\d{1,4})*|\?\d{1,4})[A-Za-z]/g, "")
    .replace(/\[(?:\?[\d;]*)?[\d;]*[ABCDHIJKfhlmnsu]/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function extractMarkedBlock(text: string, beginMarker: string, endMarker: string): string | undefined {
  const lines = stripAnsi(text).split("\n");
  let activeStart = -1;
  let lastBlock: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line === beginMarker) {
      activeStart = index;
      continue;
    }
    if (line === endMarker && activeStart >= 0) {
      const block = lines.slice(activeStart + 1, index).join("\n").trim();
      if (block.length > 0) {
        lastBlock = block;
      }
      activeStart = -1;
    }
  }
  return lastBlock;
}

function normalizePrompt(prompt: string, mode?: string): string {
  if (mode === "plan") {
    return "You are in PLAN mode. Analyze the codebase and describe what changes you would make, but do NOT apply any changes.\n\n" + prompt;
  }
  return prompt;
}

function toIsoFromEpoch(seconds?: number): string | undefined {
  if (seconds == null || !Number.isFinite(seconds)) {
    return undefined;
  }
  return new Date(seconds * 1000).toISOString();
}

function mapThreadStatus(status?: { type?: string }): WorkspaceChatInfo["status"] {
  if (status?.type === "active") return "running";
  if (status?.type === "failed") return "failed";
  return "idle";
}

function summarizePreview(preview?: string): { title?: string; summary?: string } {
  const text = (preview ?? "").trim();
  if (!text) return {};
  const title = text.split("\n")[0]?.trim() ?? "";
  return {
    title: title.length > 0 ? title.slice(0, 120) : undefined,
    summary: text.slice(0, 280),
  };
}

function getItemType(item: Record<string, unknown> | undefined): string {
  const type = typeof item?.["type"] === "string" ? item["type"] : "";
  return type.trim();
}

function getItemCallId(item: Record<string, unknown> | undefined): string | undefined {
  const direct = typeof item?.["callId"] === "string" ? item["callId"] : undefined;
  if (direct) return direct;
  return typeof item?.["call_id"] === "string" ? item["call_id"] : undefined;
}

function getItemId(item: Record<string, unknown> | undefined): string | undefined {
  return typeof item?.["id"] === "string" ? item["id"] : undefined;
}

function getTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as Record<string, unknown>;
    const text = typeof typed["text"] === "string" ? typed["text"] : "";
    if (text.length > 0) {
      out.push(text);
    }
  }
  return out.join("\n");
}

function parseMaybeJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function normalizeItemType(rawType: string): string {
  return rawType.replace(/^[A-Z]/, (c) => c.toLowerCase());
}

function parseCodexItem(
  item: Record<string, unknown> | undefined,
  context: Record<string, unknown>,
  stage: "started" | "completed",
): CliStreamEvent[] {
  if (!item) return [];

  const events: CliStreamEvent[] = [];
  const itemType = normalizeItemType(getItemType(item));

  if (itemType === "userMessage") {
    return events;
  }

  if (itemType === "agentMessage" || itemType === "message") {
    const streamedAgentMessageIds = (context.streamedAgentMessageIds as Set<string> | undefined) ?? new Set<string>();
    context.streamedAgentMessageIds = streamedAgentMessageIds;
    const itemId = getItemId(item);
    if (stage === "completed" && itemId && streamedAgentMessageIds.has(itemId)) {
      return events;
    }
    const directText = typeof item["text"] === "string" ? item["text"] : "";
    const contentText = getTextFromContent(item["content"]);
    const text = (directText || contentText).trim();
    if (text.length > 0) {
      events.push({
        type: "content_block",
        role: "assistant",
        block: { type: "text", text },
      });
    }
    return events;
  }

  if (itemType === "reasoning") {
    const directText = typeof item["text"] === "string" ? item["text"] : "";
    const summary = Array.isArray(item["summary"]) ? item["summary"] : [];
    const summaryText = summary
      .map((entry) => (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>)["text"] === "string")
        ? ((entry as Record<string, unknown>)["text"] as string)
        : "")
      .filter((part) => part.length > 0)
      .join("\n");
    const text = (directText || summaryText).trim();
    if (text.length > 0) {
      events.push({
        type: "content_block",
        role: "assistant",
        block: { type: "thinking", text },
      });
    }
    return events;
  }

  if (itemType === "functionCall") {
    const name = typeof item["name"] === "string" ? item["name"] : undefined;
    const args = typeof item["arguments"] === "string" ? item["arguments"] : "";
    if (stage === "started" && (name === "shell" || name === "run_command")) {
      let command = args;
      try {
        const parsed = JSON.parse(args || "{}") as Record<string, unknown>;
        command = (typeof parsed["command"] === "string" ? parsed["command"] : undefined)
          ?? (typeof parsed["cmd"] === "string" ? parsed["cmd"] : undefined)
          ?? args;
      } catch {
        // Keep raw string.
      }
      const intent = describeCommandIntent(command);
      const intentKey = getCommandIntentKey(intent);
      const counts = (context.pendingSemanticCommands as Record<string, number> | undefined) ?? {};
      context.pendingSemanticCommands = counts;
      if (intent.kind === "read" && intent.filePath) {
        if (intentKey) {
          counts[intentKey] = (counts[intentKey] ?? 0) + 1;
        }
        events.push({
          type: "content_block",
          role: "assistant",
          block: {
            type: "tool_use",
            toolName: "Read",
            toolId: getItemCallId(item),
            toolInput: { file_path: intent.filePath },
          },
        });
        return events;
      }
      if (intent.kind === "search" && intent.pattern) {
        if (intentKey) {
          counts[intentKey] = (counts[intentKey] ?? 0) + 1;
        }
        events.push({
          type: "content_block",
          role: "assistant",
          block: {
            type: "tool_use",
            toolName: "Grep",
            toolId: getItemCallId(item),
            toolInput: { pattern: intent.pattern, path: intent.path },
          },
        });
        return events;
      }
      if (intent.kind === "list") {
        if (intentKey) {
          counts[intentKey] = (counts[intentKey] ?? 0) + 1;
        }
        events.push({
          type: "content_block",
          role: "assistant",
          block: {
            type: "tool_use",
            toolName: "Glob",
            toolId: getItemCallId(item),
            toolInput: { path: intent.path },
          },
        });
        return events;
      }
      events.push({
        type: "content_block",
        role: "assistant",
        block: {
          type: "command_exec",
          command: intent.command,
          toolName: name,
        },
      });
      return events;
    }

    if (stage === "started") {
      events.push({
        type: "content_block",
        role: "assistant",
        block: {
          type: "tool_use",
          toolName: name ?? "tool",
          toolId: getItemCallId(item),
          toolInput: parseMaybeJson(args),
        },
      });
    }
    return events;
  }

  if (itemType === "functionCallOutput") {
    const output = typeof item["output"] === "string" ? item["output"] : "";
    events.push({
      type: "content_block",
      role: "assistant",
      block: {
        type: "tool_result",
        toolId: getItemCallId(item),
        result: sanitizeCodexToolOutput(output),
      },
    });
    return events;
  }

  if (itemType === "commandExecution" || itemType === "localShellCall") {
    const command = (typeof item["command"] === "string" ? item["command"] : undefined)
      ?? (typeof item["cmd"] === "string" ? item["cmd"] : undefined)
      ?? "";
    const output = sanitizeCodexToolOutput(
      (typeof item["output"] === "string" ? item["output"] : undefined)
      ?? (typeof item["stdout"] === "string" ? item["stdout"] : undefined)
      ?? "",
    );
    const exitCode = typeof item["exitCode"] === "number"
      ? item["exitCode"]
      : (typeof item["exit_code"] === "number" ? item["exit_code"] : undefined);
    const intent = describeCommandIntent(command);
    const intentKey = getCommandIntentKey(intent);
    const counts = (context.pendingSemanticCommands as Record<string, number> | undefined) ?? {};
    if (
      intentKey &&
      (intent.kind === "read" || intent.kind === "search" || intent.kind === "list") &&
      (counts[intentKey] ?? 0) > 0
    ) {
      const nextCount = (counts[intentKey] ?? 0) - 1;
      if (nextCount <= 0) {
        delete counts[intentKey];
      } else {
        counts[intentKey] = nextCount;
      }
      return events;
    }
    events.push({
      type: "content_block",
      role: "assistant",
      block: {
        type: "command_exec",
        command: intent.command,
        output,
        exitCode,
      },
    });
    return events;
  }

  if (itemType === "fileChange") {
    const filePath = (typeof item["filePath"] === "string" ? item["filePath"] : undefined)
      ?? (typeof item["file_path"] === "string" ? item["file_path"] : undefined)
      ?? (typeof item["path"] === "string" ? item["path"] : undefined)
      ?? "";
    const diff = (typeof item["diff"] === "string" ? item["diff"] : undefined)
      ?? (typeof item["patch"] === "string" ? item["patch"] : undefined)
      ?? (typeof item["content"] === "string" ? item["content"] : undefined)
      ?? "";
    events.push({
      type: "content_block",
      role: "assistant",
      block: {
        type: "file_change",
        filePath,
        diff,
      },
    });
  }

  return events;
}

export class CodexAppServerTransport {
  private readonly connections = new Map<string, AppServerConnection>();
  private readonly connecting = new Map<string, Promise<AppServerConnection>>();
  private readonly resolvedCodexBin = new Map<string, string>();
  private static readonly CLIENT_NAME = "openvide";
  private static readonly CLIENT_VERSION = "0.1.0";
  private static readonly REQUEST_TIMEOUT_MS = 30000;
  private static readonly OPEN_TIMEOUT_MS = 2500;
  private static readonly BOOT_TIMEOUT_MS = 30000;

  constructor(
    private readonly ssh: NativeSshClient,
    private readonly serverSsh: NativeSshClient = new NativeSshClient(),
    private readonly tunnelSsh: NativeSshClient = new NativeSshClient(),
  ) {}

  async resetAllConnections(): Promise<void> {
    const targetIds = [...this.connections.keys()];
    await Promise.all(targetIds.map((targetId) => this.closeConnection(targetId)));
    this.resolvedCodexBin.clear();
    await Promise.all([
      this.ssh.dispose().catch(() => {}),
      this.serverSsh.dispose().catch(() => {}),
      this.tunnelSsh.dispose().catch(() => {}),
    ]);
  }

  private remotePortForTarget(targetId: string): number {
    let hash = 0;
    for (let i = 0; i < targetId.length; i += 1) {
      hash = (hash * 33 + targetId.charCodeAt(i)) >>> 0;
    }
    return 47000 + (hash % 1000);
  }

  private rejectPending(connection: AppServerConnection, message: string): void {
    for (const [id, pending] of connection.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
      connection.pending.delete(id);
    }
  }

  private async closeConnection(targetId: string): Promise<void> {
    const connection = this.connections.get(targetId);
    this.connecting.delete(targetId);
    if (!connection) {
      return;
    }

    this.connections.delete(targetId);
    this.rejectPending(connection, "Codex app-server connection closed.");
    for (const listener of connection.listeners) {
      listener({ method: "__connection_closed__" });
    }

    try {
      connection.socket.close();
    } catch {
      // no-op
    }
    await Promise.all([
      this.tunnelSsh.stopLocalPortForward(targetId, connection.tunnel.tunnelId).catch(() => {}),
    ]);
  }

  private serverPaths(targetId: string): { logPath: string; pidPath: string } {
    const safeId = targetId.replace(/[^a-zA-Z0-9_-]/g, "");
    return {
      logPath: `/tmp/openvide-codex-app-server-${safeId}.log`,
      pidPath: `/tmp/openvide-codex-app-server-${safeId}.pid`,
    };
  }

  private async resolveCodexBinary(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<string> {
    const cached = this.resolvedCodexBin.get(target.id);
    if (cached) {
      return cached;
    }

    const command = [
      "OV_CODEX_BIN=\"$(command -v codex 2>/dev/null || true)\"",
      "if [ -z \"$OV_CODEX_BIN\" ]; then",
      "  for C in \"$HOME/.npm-global/bin/codex\" \"$HOME/.local/bin/codex\" \"/opt/homebrew/bin/codex\" \"/usr/local/bin/codex\"; do",
      "    [ -x \"$C\" ] && OV_CODEX_BIN=\"$C\" && break",
      "  done",
      "fi",
      "if [ -z \"$OV_CODEX_BIN\" ] && [ -d \"$HOME/.nvm/versions/node\" ]; then",
      "  for C in \"$HOME\"/.nvm/versions/node/*/bin/codex; do",
      "    [ -x \"$C\" ] && OV_CODEX_BIN=\"$C\"",
      "  done",
      "fi",
      "echo \"__OV_CODEX_BIN:${OV_CODEX_BIN:-NOT_FOUND}\"",
    ].join("\n");

    const stdout = await this.runSshCommand(target, credentials, command, 10000, this.serverSsh, "resolve codex binary");
    const match = stdout.match(/__OV_CODEX_BIN:(\/[^\s"']+)/);
    const resolved = match?.[1]?.trim();
    if (!resolved) {
      throw new Error("Codex binary not found on host.");
    }
    this.resolvedCodexBin.set(target.id, resolved);
    return resolved;
  }

  private async startServerProcess(
    target: TargetProfile,
    credentials: SshCredentials,
    remotePort: number,
  ): Promise<{ pid?: number; logPath: string; pidPath: string }> {
    const { logPath, pidPath } = this.serverPaths(target.id);
    const codexBin = await this.resolveCodexBinary(target, credentials);
    const command = [
      "set +m 2>/dev/null || true",
      `OV_PIDFILE=${escapeShellArg(pidPath)}`,
      `OV_LOG=${escapeShellArg(logPath)}`,
      `OV_CODEX_BIN=${escapeShellArg(codexBin)}`,
      `OV_RESULT_BEGIN=${escapeShellArg(CODEX_START_RESULT_BEGIN)}`,
      `OV_RESULT_END=${escapeShellArg(CODEX_START_RESULT_END)}`,
      "if [ -f \"$OV_PIDFILE\" ]; then",
      "  OV_EXISTING_PID=$(cat \"$OV_PIDFILE\" 2>/dev/null || true)",
      "  if [ -n \"$OV_EXISTING_PID\" ] && kill -0 \"$OV_EXISTING_PID\" 2>/dev/null; then",
      "    printf '%s\\n{\"ok\":true,\"pid\":%s,\"reused\":true}\\n%s\\n' \"$OV_RESULT_BEGIN\" \"$OV_EXISTING_PID\" \"$OV_RESULT_END\"",
      "    exit 0",
      "  fi",
      "  rm -f \"$OV_PIDFILE\"",
      "fi",
      `nohup "$OV_CODEX_BIN" app-server --listen "ws://127.0.0.1:${remotePort}" >> "$OV_LOG" 2>&1 </dev/null &`,
      "OV_PID=$!",
      "disown \"$OV_PID\" >/dev/null 2>&1 || true",
      "printf '%s' \"$OV_PID\" > \"$OV_PIDFILE\"",
      "printf '%s\\n{\"ok\":true,\"pid\":%s,\"reused\":false}\\n%s\\n' \"$OV_RESULT_BEGIN\" \"$OV_PID\" \"$OV_RESULT_END\"",
    ].join("\n");

    const stdout = await this.runSshCommand(target, credentials, command, 10000, this.serverSsh, "start codex app-server");
    const markedResult = extractMarkedBlock(stdout, CODEX_START_RESULT_BEGIN, CODEX_START_RESULT_END);
    if (markedResult) {
      try {
        const parsed = JSON.parse(markedResult) as Record<string, unknown>;
        if (parsed["ok"] === true) {
          await this.serverSsh.resetTargetSession(target.id).catch(() => {});
          return {
            pid: typeof parsed["pid"] === "number" ? parsed["pid"] : undefined,
            logPath,
            pidPath,
          };
        }
      } catch {
        // Fall through to legacy parsing and diagnostics.
      }
    }
    const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    let reportedError: string | undefined;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i] ?? "") as Record<string, unknown>;
        if (parsed["ok"] === true) {
          await this.serverSsh.resetTargetSession(target.id).catch(() => {});
          return {
            pid: typeof parsed["pid"] === "number" ? parsed["pid"] : undefined,
            logPath,
            pidPath,
          };
        }
        if (typeof parsed["error"] === "string") {
          reportedError = parsed["error"];
        }
      } catch {
        // Ignore shell noise.
      }
    }
    console.log(
      `[OV:codex] start codex app-server unexpected stdout target=${target.id.slice(0, 12)} tail=\n${stripAnsi(stdout).slice(-1200)}`,
    );
    await this.serverSsh.resetTargetSession(target.id).catch(() => {});
    const diagnostics = await this.collectStartupDiagnostics(
      target,
      credentials,
      remotePort,
      logPath,
      pidPath,
      codexBin,
    );
    throw new Error(
      reportedError
        ? `Failed to start Codex app-server: ${reportedError}\n${diagnostics}`
        : `Failed to start Codex app-server.\n${diagnostics}`,
    );
  }

  private async collectStartupDiagnostics(
    target: TargetProfile,
    credentials: SshCredentials,
    remotePort: number,
    logPath: string,
    pidPath: string,
    codexBin?: string,
  ): Promise<string> {
    const command = [
      "set +e",
      `OV_PIDFILE=${escapeShellArg(pidPath)}`,
      `OV_LOG=${escapeShellArg(logPath)}`,
      `OV_CODEX_BIN=${codexBin ? escapeShellArg(codexBin) : "\"\""}`,
      "echo '__OV_DIAG_BEGIN__'",
      "echo \"codex_path=$(command -v codex 2>/dev/null || true)\"",
      "echo \"resolved_codex_bin=$OV_CODEX_BIN\"",
      "if [ -n \"$OV_CODEX_BIN\" ] && [ -x \"$OV_CODEX_BIN\" ]; then",
      "  echo \"resolved_codex_version=$($OV_CODEX_BIN --version </dev/null 2>/dev/null | head -n 1)\"",
      "else",
      "  echo 'resolved_codex_version='",
      "fi",
      "if [ -f \"$OV_PIDFILE\" ]; then",
      "  OV_PID=$(cat \"$OV_PIDFILE\" 2>/dev/null || true)",
      "  echo \"pidfile=$OV_PID\"",
      "  if [ -n \"$OV_PID\" ] && kill -0 \"$OV_PID\" 2>/dev/null; then",
      "    echo 'pid_alive=yes'",
      "  else",
      "    echo 'pid_alive=no'",
      "  fi",
      "else",
      "  echo 'pidfile='",
      "  echo 'pid_alive=no_pidfile'",
      "fi",
      `if command -v ss >/dev/null 2>&1; then ss -ltn 2>/dev/null | grep -F ':${remotePort} ' | tail -n 1 | sed 's/^/port_listen=/' || echo 'port_listen=';`,
      `elif command -v netstat >/dev/null 2>&1; then netstat -an 2>/dev/null | grep -F '.${remotePort} ' | grep LISTEN | tail -n 1 | sed 's/^/port_listen=/' || echo 'port_listen=';`,
      "else echo 'port_listen=unknown'; fi",
      "if [ -f \"$OV_LOG\" ]; then",
      "  echo '__OV_LOG_TAIL__'",
      "  tail -n 20 \"$OV_LOG\"",
      "else",
      "  echo '__OV_LOG_TAIL__'",
      "  echo '[missing log file]'",
      "fi",
      "echo '__OV_DIAG_END__'",
    ].join("\n");

    const stdout = await this.runSshCommand(target, credentials, command, 10000, this.serverSsh, "collect codex diagnostics").catch((error) => {
      return `diagnostics_failed=${error instanceof Error ? error.message : String(error)}`;
    });
    return stripAnsi(stdout).trim();
  }

  private async openSocket(url: string): Promise<WebSocket> {
    return await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          // no-op
        }
        reject(new Error("Timed out opening Codex app-server websocket."));
      }, CodexAppServerTransport.OPEN_TIMEOUT_MS);

      socket.onopen = () => {
        clearTimeout(timer);
        resolve(socket);
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Failed to open Codex app-server websocket."));
      };
    });
  }

  private async openSocketWithRetry(
    url: string,
    timeoutMs: number,
  ): Promise<WebSocket> {
    const startedAt = Date.now();
    let lastError: Error | undefined;
    while (Date.now() - startedAt < timeoutMs) {
      try {
        return await this.openSocket(url);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
      }
    }
    throw lastError ?? new Error("Timed out opening Codex app-server websocket.");
  }

  private onSocketMessage(connection: AppServerConnection, rawData: unknown): void {
    const text = typeof rawData === "string" ? rawData : "";
    if (!text.trim()) {
      return;
    }

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }

    const id = typeof message["id"] === "number" ? message["id"] : undefined;
    const method = typeof message["method"] === "string" ? message["method"] : undefined;

    if (id != null && !method) {
      const pending = connection.pending.get(id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      connection.pending.delete(id);
      const error = message["error"] as Record<string, unknown> | undefined;
      if (error) {
        pending.reject(new Error(typeof error["message"] === "string" ? error["message"] : "Codex app-server request failed."));
        return;
      }
      pending.resolve(message);
      return;
    }

    if (id != null && method) {
      const response = {
        id,
        error: {
          code: -32601,
          message: `Unsupported server request '${method}'.`,
        },
      };
      connection.socket.send(JSON.stringify(response));
      return;
    }

    for (const listener of connection.listeners) {
      listener(message);
    }
  }

  private async initializeConnection(connection: AppServerConnection): Promise<void> {
    await this.request(connection, "initialize", {
      clientInfo: {
        name: CodexAppServerTransport.CLIENT_NAME,
        version: CodexAppServerTransport.CLIENT_VERSION,
      },
      capabilities: {},
    });
    connection.socket.send(JSON.stringify({ method: "initialized", params: {} }));
  }

  private async createConnection(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<AppServerConnection> {
    const startedAt = Date.now();
    const remotePort = this.remotePortForTarget(target.id);
    console.log(`[OV:codex] createConnection start target=${target.id.slice(0, 12)} remotePort=${remotePort}`);
    const server = await this.startServerProcess(target, credentials, remotePort);
    console.log(`[OV:codex] server ready target=${target.id.slice(0, 12)} pid=${server.pid ?? "unknown"} +${Date.now() - startedAt}ms`);
    const tunnel = await this.tunnelSsh.startLocalPortForward(target, credentials, {
      remoteHost: "127.0.0.1",
      remotePort,
      localHost: "127.0.0.1",
      localPort: 0,
    });
    console.log(
      `[OV:codex] tunnel ready target=${target.id.slice(0, 12)} local=${tunnel.localHost}:${tunnel.localPort} +${Date.now() - startedAt}ms`,
    );
    let socket: WebSocket;
    try {
      socket = await this.openSocketWithRetry(
        `ws://${tunnel.localHost}:${tunnel.localPort}`,
        CodexAppServerTransport.BOOT_TIMEOUT_MS,
      );
    } catch (error) {
      await this.serverSsh.resetTargetSession(target.id).catch(() => {});
      const diagnostics = await this.collectStartupDiagnostics(
        target,
        credentials,
        remotePort,
        server.logPath,
        server.pidPath,
      );
      await this.tunnelSsh.stopLocalPortForward(target.id, tunnel.tunnelId).catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\n${diagnostics}`);
    }
    console.log(`[OV:codex] websocket open target=${target.id.slice(0, 12)} +${Date.now() - startedAt}ms`);
    const connection: AppServerConnection = {
      targetId: target.id,
      remotePort,
      socket,
      serverPid: server.pid,
      serverLogPath: server.logPath,
      serverPidPath: server.pidPath,
      tunnel,
      nextId: 1,
      pending: new Map<number, JsonRpcPending>(),
      listeners: new Set(),
    };
    socket.onmessage = (event) => {
      this.onSocketMessage(connection, event.data);
    };
    socket.onerror = () => {
      void this.closeConnection(target.id);
    };
    socket.onclose = () => {
      void this.closeConnection(target.id);
    };
    await this.initializeConnection(connection);
    console.log(`[OV:codex] initialized target=${target.id.slice(0, 12)} +${Date.now() - startedAt}ms`);
    this.connections.set(target.id, connection);
    return connection;
  }

  private async ensureConnection(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<AppServerConnection> {
    const existing = this.connections.get(target.id);
    if (existing && existing.socket.readyState === WebSocket.OPEN) {
      return existing;
    }
    const inFlight = this.connecting.get(target.id);
    if (inFlight) {
      return await inFlight;
    }
    const promise = this.createConnection(target, credentials)
      .finally(() => {
        this.connecting.delete(target.id);
      });
    this.connecting.set(target.id, promise);
    return await promise;
  }

  private async request(
    connection: AppServerConnection,
    method: string,
    params: Record<string, unknown>,
    timeoutMs = CodexAppServerTransport.REQUEST_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    const id = connection.nextId++;
    const payload = { id, method, params };

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        connection.pending.delete(id);
        void this.closeConnection(connection.targetId);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);

      connection.pending.set(id, { resolve, reject, timeout });
      try {
        connection.socket.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timeout);
        connection.pending.delete(id);
        void this.closeConnection(connection.targetId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private subscribe(
    connection: AppServerConnection,
    listener: (message: Record<string, unknown>) => void,
  ): () => void {
    connection.listeners.add(listener);
    return () => {
      connection.listeners.delete(listener);
    };
  }

  private async runSshCommand(
    target: TargetProfile,
    credentials: SshCredentials,
    command: string,
    timeoutMs = 15000,
    sshClient: NativeSshClient = this.ssh,
    label = "SSH command",
  ): Promise<string> {
    const startedAt = Date.now();
    console.log(`[OV:codex] ssh start label="${label}" target=${target.id.slice(0, 12)} timeout=${timeoutMs}ms`);
    let handle: Awaited<ReturnType<NativeSshClient["runCommand"]>> | undefined;
    try {
      const result = await Promise.race([
        (async () => {
          handle = await sshClient.runCommand(
            target,
            credentials,
            command,
            { onStdout: () => {}, onStderr: () => {} },
            { mode: "scripted", conflictPolicy: "queue" },
          );
          return await handle.wait;
        })(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)),
      ]);
      console.log(
        `[OV:codex] ssh done label="${label}" target=${target.id.slice(0, 12)} exit=${result.exitCode ?? "null"} +${Date.now() - startedAt}ms`,
      );
      return stripAnsi(result.stdout);
    } catch (error) {
      console.log(
        `[OV:codex] ssh fail label="${label}" target=${target.id.slice(0, 12)} +${Date.now() - startedAt}ms err=${error instanceof Error ? error.message : String(error)}`,
      );
      handle?.cancel().catch(() => {});
      await sshClient.resetTargetSession(target.id).catch(() => {});
      throw error;
    }
  }

  async listModels(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<CodexModelInfo[]> {
    const connection = await this.ensureConnection(target, credentials);
    const response = await this.request(connection, "model/list", { limit: 200 });
    const result = response["result"] as Record<string, unknown> | undefined;
    const data = Array.isArray(result?.["data"]) ? result["data"] : [];
    const seen = new Set<string>();
    const models: CodexModelInfo[] = [];
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const id = typeof item["id"] === "string" ? item["id"].trim() : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push({
        id,
        displayName: typeof item["displayName"] === "string" && item["displayName"].trim().length > 0
          ? item["displayName"].trim()
          : id,
        hidden: item["hidden"] === true,
        isDefault: item["isDefault"] === true,
      });
    }
    return models;
  }

  async listWorkspaceThreads(
    target: TargetProfile,
    credentials: SshCredentials,
    cwd: string,
  ): Promise<WorkspaceChatInfo[]> {
    const connection = await this.ensureConnection(target, credentials);
    const chats: WorkspaceChatInfo[] = [];
    let cursor: string | undefined;

    while (true) {
      const response = await this.request(connection, "thread/list", {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      const result = response["result"] as Record<string, unknown> | undefined;
      const data = Array.isArray(result?.["data"]) ? result["data"] : [];
      for (const row of data) {
        if (!row || typeof row !== "object") continue;
        const thread = row as Record<string, unknown>;
        const record: CodexThreadRecord = {
          id: typeof thread["id"] === "string" ? thread["id"] : "",
          cwd: typeof thread["cwd"] === "string" ? thread["cwd"] : undefined,
          path: typeof thread["path"] === "string" ? thread["path"] : undefined,
          preview: typeof thread["preview"] === "string" ? thread["preview"] : undefined,
          name: typeof thread["name"] === "string" ? thread["name"] : undefined,
          createdAt: typeof thread["createdAt"] === "number" ? thread["createdAt"] : undefined,
          updatedAt: typeof thread["updatedAt"] === "number" ? thread["updatedAt"] : undefined,
          status: thread["status"] as { type?: string } | undefined,
        };
        if (!record.id || record.cwd !== cwd) {
          continue;
        }
        const preview = summarizePreview(record.name || record.preview);
        chats.push({
          id: record.id,
          origin: "app_server",
          tool: "codex",
          status: mapThreadStatus(record.status),
          workingDirectory: record.cwd ?? cwd,
          resumeId: record.id,
          conversationId: record.id,
          createdAt: toIsoFromEpoch(record.createdAt),
          updatedAt: toIsoFromEpoch(record.updatedAt),
          title: preview.title,
          summary: preview.summary,
          messageCount: undefined,
          historyPath: record.path,
          outputLines: 0,
          outputBytes: 0,
        } as WorkspaceChatInfo);
      }
      cursor = typeof result?.["nextCursor"] === "string" ? result["nextCursor"] : undefined;
      if (!cursor) {
        break;
      }
    }

    return chats;
  }

  async readThreadMeta(
    target: TargetProfile,
    credentials: SshCredentials,
    threadId: string,
  ): Promise<{ historyPath?: string; status?: string }> {
    const connection = await this.ensureConnection(target, credentials);
    const response = await this.request(connection, "thread/read", { threadId });
    const result = response["result"] as Record<string, unknown> | undefined;
    const thread = result?.["thread"] as Record<string, unknown> | undefined;
    const status = thread?.["status"] as Record<string, unknown> | undefined;
    return {
      historyPath: typeof thread?.["path"] === "string" ? thread["path"] : undefined,
      status: typeof status?.["type"] === "string" ? status["type"] : undefined,
    };
  }

  async readThreadHistory(
    target: TargetProfile,
    credentials: SshCredentials,
    historyPath: string,
    limitLines = 8000,
  ): Promise<SessionHistoryPayload> {
    const marker = `__OV_CODEX_HISTORY_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    const escapedPath = escapeShellArg(historyPath);
    const command = [
      `if [ -f ${escapedPath} ]; then`,
      `  printf '${marker} START\\n'`,
      `  tail -n ${Math.max(1, limitLines)} ${escapedPath}`,
      `  printf '\\n${marker} END\\n'`,
      "else",
      `  printf '${marker} START\\n${marker} END\\n'`,
      "fi",
    ].join("\n");
    const stdout = await this.runSshCommand(target, credentials, command, 30000, this.ssh, "read codex history");
    const end = stdout.lastIndexOf(`${marker} END`);
    const start = end >= 0 ? stdout.lastIndexOf(`${marker} START`, end) : -1;
    const body = start >= 0 && end > start
      ? stdout.slice(start + `${marker} START`.length, end)
      : "";
    const lines = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return {
      source: "native",
      tool: "codex",
      format: "native_codex_jsonl",
      lines,
      lineCount: lines.length,
      truncated: false,
    };
  }

  async interruptTurn(
    target: TargetProfile,
    credentials: SshCredentials,
    threadId: string,
    turnId: string,
  ): Promise<void> {
    const connection = await this.ensureConnection(target, credentials);
    await this.request(connection, "turn/interrupt", { threadId, turnId });
  }

  async runTurn(
    target: TargetProfile,
    credentials: SshCredentials,
    input: {
      threadId?: string;
      workingDirectory?: string;
      prompt: string;
      mode?: string;
      model?: string;
      signal: { cancelled: boolean };
      onEvent: (event: CliStreamEvent) => void;
      onStarted?: (info: { threadId: string; turnId: string; historyPath?: string }) => void;
    },
  ): Promise<{
    threadId: string;
    turnId: string;
    historyPath?: string;
    status: "completed" | "failed" | "interrupted";
    errorText?: string;
  }> {
    const connection = await this.ensureConnection(target, credentials);
    let threadId = input.threadId;
    let historyPath: string | undefined;

    if (!threadId) {
      const threadStart = await this.request(connection, "thread/start", {
        cwd: input.workingDirectory ?? "~",
        approvalPolicy: "never",
        ...(input.model ? { model: input.model } : {}),
      });
      const result = threadStart["result"] as Record<string, unknown> | undefined;
      const thread = result?.["thread"] as Record<string, unknown> | undefined;
      threadId = typeof thread?.["id"] === "string" ? thread["id"] : undefined;
      historyPath = typeof thread?.["path"] === "string" ? thread["path"] : undefined;
      const model = typeof result?.["model"] === "string" ? result["model"] : undefined;
      if (model) {
        input.onEvent({ type: "model", model });
      }
    }

    if (!threadId) {
      throw new Error("Codex app-server did not return a thread id.");
    }

    const parseContext: Record<string, unknown> = {
      pendingSemanticCommands: {},
    };

    const turnStart = await this.request(connection, "turn/start", {
      threadId,
      ...(input.model ? { model: input.model } : {}),
      input: [
        {
          type: "text",
          text: normalizePrompt(input.prompt, input.mode),
        },
      ],
    });
    const turnResult = turnStart["result"] as Record<string, unknown> | undefined;
    const turn = turnResult?.["turn"] as Record<string, unknown> | undefined;
    const turnId = typeof turn?.["id"] === "string" ? turn["id"] : undefined;
    if (!turnId) {
      throw new Error("Codex app-server did not return a turn id.");
    }

    input.onStarted?.({ threadId, turnId, historyPath });

    input.onEvent({ type: "message_start", role: "assistant" });

    return await new Promise<{
      threadId: string;
      turnId: string;
      historyPath?: string;
      status: "completed" | "failed" | "interrupted";
      errorText?: string;
    }>((resolve, reject) => {
      let settled = false;
      let interruptRequested = false;

      const finish = (result: {
        threadId: string;
        turnId: string;
        historyPath?: string;
        status: "completed" | "failed" | "interrupted";
        errorText?: string;
      }): void => {
        if (settled) return;
        settled = true;
        unsubscribe();
        unsubscribeClosed();
        resolve(result);
      };

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        unsubscribe();
        unsubscribeClosed();
        reject(error);
      };

      const unsubscribe = this.subscribe(connection, (message) => {
        const method = typeof message["method"] === "string" ? message["method"] : "";
        const params = message["params"] as Record<string, unknown> | undefined;

        if (input.signal.cancelled && !interruptRequested) {
          interruptRequested = true;
          void this.request(connection, "turn/interrupt", { threadId, turnId }).catch(() => {});
        }

        if (method === "item/started" || method === "item/completed") {
          if (params?.["threadId"] !== threadId || params?.["turnId"] !== turnId) {
            return;
          }
          const item = params["item"] as Record<string, unknown> | undefined;
          const stage = method === "item/started" ? "started" : "completed";
          const events = parseCodexItem(item, parseContext, stage);
          for (const event of events) {
            input.onEvent(event);
          }
          return;
        }

        if (method === "item/agentMessage/delta") {
          if (params?.["threadId"] !== threadId || params?.["turnId"] !== turnId) {
            return;
          }
          const itemId = typeof params["itemId"] === "string" ? params["itemId"] : undefined;
          const streamedAgentMessageIds = (parseContext.streamedAgentMessageIds as Set<string> | undefined) ?? new Set<string>();
          parseContext.streamedAgentMessageIds = streamedAgentMessageIds;
          if (itemId) {
            streamedAgentMessageIds.add(itemId);
          }
          const delta = typeof params["delta"] === "string" ? params["delta"] : "";
          if (!delta) {
            return;
          }
          input.onEvent({
            type: "content_block",
            role: "assistant",
            block: { type: "text", text: delta },
          });
          return;
        }

        if (method === "thread/tokenUsage/updated") {
          if (params?.["threadId"] !== threadId || params?.["turnId"] !== turnId) {
            return;
          }
          const tokenUsage = params["tokenUsage"] as Record<string, unknown> | undefined;
          const total = tokenUsage?.["total"] as Record<string, unknown> | undefined;
          const modelContextWindow = typeof tokenUsage?.["modelContextWindow"] === "number"
            ? tokenUsage["modelContextWindow"]
            : undefined;
          input.onEvent({
            type: "usage",
            inputTokens: typeof total?.["inputTokens"] === "number" ? total["inputTokens"] : undefined,
            outputTokens: typeof total?.["outputTokens"] === "number" ? total["outputTokens"] : undefined,
            contextUsedTokens: typeof total?.["totalTokens"] === "number" ? total["totalTokens"] : undefined,
            contextWindowTokens: modelContextWindow,
            contextSource: "provider",
          });
          return;
        }

        if (method === "error") {
          if (params?.["threadId"] !== threadId || params?.["turnId"] !== turnId) {
            return;
          }
          const willRetry = params?.["willRetry"] === true;
          if (willRetry) {
            return;
          }
          const error = params?.["error"] as Record<string, unknown> | undefined;
          const messageText = typeof error?.["message"] === "string"
            ? error["message"]
            : "Codex app-server turn failed.";
          input.onEvent({
            type: "error",
            block: { type: "error", text: messageText },
          });
          finish({
            threadId,
            turnId,
            historyPath,
            status: "failed",
            errorText: messageText,
          });
          return;
        }

        if (method === "turn/completed") {
          if (params?.["threadId"] !== threadId) {
            return;
          }
          const completedTurn = params["turn"] as Record<string, unknown> | undefined;
          if (completedTurn?.["id"] !== turnId) {
            return;
          }
          const status = typeof completedTurn?.["status"] === "string" ? completedTurn["status"] : "completed";
          input.onEvent({ type: "message_complete", conversationId: threadId });
          finish({
            threadId,
            turnId,
            historyPath,
            status: status === "interrupted" ? "interrupted" : "completed",
          });
          return;
        }

        if (method === "turn/failed") {
          if (params?.["threadId"] !== threadId) {
            return;
          }
          const failedTurn = params["turn"] as Record<string, unknown> | undefined;
          if (failedTurn?.["id"] !== turnId) {
            return;
          }
          const errorText = typeof failedTurn?.["error"] === "string"
            ? failedTurn["error"]
            : "Codex app-server turn failed.";
          input.onEvent({
            type: "error",
            block: { type: "error", text: errorText },
          });
          finish({
            threadId,
            turnId,
            historyPath,
            status: "failed",
            errorText,
          });
        }
      });

      void (async () => {
        try {
          const meta = await this.readThreadMeta(target, credentials, threadId);
          historyPath = historyPath ?? meta.historyPath;
        } catch {
          // Best effort.
        }
      })();

      const socketClosedListener = (message: Record<string, unknown>): void => {
        const method = typeof message["method"] === "string" ? message["method"] : "";
        if (method === "__connection_closed__") {
          fail(new Error("Codex app-server websocket closed."));
        }
      };
      const unsubscribeClosed = this.subscribe(connection, socketClosedListener);
    });
  }
}
