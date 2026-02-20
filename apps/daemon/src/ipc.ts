import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { daemonDir, log, logError } from "./utils.js";
import * as sm from "./sessionManager.js";
import type { IpcRequest, IpcResponse, Tool } from "./types.js";
import { listNativeSessionsForWorkspace, mergeWorkspaceSessions } from "./nativeHistory/index.js";
import { readHistoryForDaemonSession, readHistoryForNativeSession } from "./historyStore.js";

const SOCKET_NAME = "daemon.sock";

function socketPath(): string {
  return path.join(daemonDir(), SOCKET_NAME);
}

// ── Server (runs in daemon) ──

export function startServer(): net.Server {
  const sockPath = socketPath();

  // Clean up stale socket
  try {
    fs.unlinkSync(sockPath);
  } catch {
    // doesn't exist
  }

  const server = net.createServer((conn) => {
    let data = "";

    conn.on("data", (chunk) => {
      data += chunk.toString();
      const newlineIdx = data.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = data.slice(0, newlineIdx);
        data = data.slice(newlineIdx + 1);
        handleRequest(line, conn);
      }
    });

    conn.on("error", (err) => {
      logError("IPC connection error:", err.message);
    });
  });

  server.listen(sockPath, () => {
    // Make socket accessible
    fs.chmodSync(sockPath, 0o700);
    log(`IPC server listening on ${sockPath}`);
  });

  server.on("error", (err) => {
    logError("IPC server error:", err.message);
  });

  return server;
}

function handleRequest(raw: string, conn: net.Socket): void {
  let req: IpcRequest;
  try {
    req = JSON.parse(raw) as IpcRequest;
  } catch {
    respond(conn, { ok: false, error: "Invalid JSON" });
    return;
  }

  void routeCommand(req)
    .then((response) => {
      respond(conn, response);
    })
    .catch((err) => {
      respond(conn, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
}

function respond(conn: net.Socket, res: IpcResponse): void {
  conn.end(JSON.stringify(res) + "\n");
}

async function routeCommand(req: IpcRequest): Promise<IpcResponse> {
  switch (req.cmd) {
    case "health": {
      const sessions = sm.listSessions();
      return {
        ok: true,
        pid: process.pid,
        activeSessions: sm.getActiveCount(),
        totalSessions: sessions.length,
      };
    }

    case "session.create": {
      const tool = req.tool as Tool | undefined;
      const cwd = req.cwd as string | undefined;
      if (!tool || !cwd) {
        return { ok: false, error: "Missing required: tool, cwd" };
      }
      const session = sm.createSession(
        tool,
        cwd,
        req.model as string | undefined,
        req.autoAccept as boolean | undefined,
        req.conversationId as string | undefined,
      );
      return { ok: true, session };
    }

    case "session.send": {
      const id = req.id as string | undefined;
      const prompt = req.prompt as string | undefined;
      if (!id || !prompt) {
        return { ok: false, error: "Missing required: id, prompt" };
      }
      return sm.sendTurn(id, prompt);
    }

    case "session.cancel": {
      const id = req.id as string | undefined;
      if (!id) return { ok: false, error: "Missing required: id" };
      return sm.cancelSession(id);
    }

    case "session.list": {
      return { ok: true, sessions: sm.listSessions() };
    }

    case "session.list_native": {
      const cwd = req.cwd as string | undefined;
      const tool = req.tool as "claude" | "codex" | "all" | undefined;
      if (!cwd) return { ok: false, error: "Missing required: cwd" };
      if (tool && tool !== "claude" && tool !== "codex" && tool !== "all") {
        return { ok: false, error: "Invalid tool filter. Expected claude, codex, or all." };
      }
      const sessions = await listNativeSessionsForWorkspace({ cwd, tool: tool ?? "all" });
      return { ok: true, sessions };
    }

    case "session.list_workspace": {
      const cwd = req.cwd as string | undefined;
      if (!cwd) return { ok: false, error: "Missing required: cwd" };
      const daemonSessions = sm.listSessions();
      const nativeSessions = await listNativeSessionsForWorkspace({ cwd, tool: "all" });
      const sessions = mergeWorkspaceSessions({
        cwd,
        daemonSessions,
        nativeSessions,
      });
      return { ok: true, sessions };
    }

    case "session.get": {
      const id = req.id as string | undefined;
      if (!id) return { ok: false, error: "Missing required: id" };
      const session = sm.getSession(id);
      if (!session) return { ok: false, error: `Session ${id} not found` };
      return { ok: true, session };
    }

    case "session.history": {
      const id = req.id as string | undefined;
      const tool = req.tool as "claude" | "codex" | undefined;
      const resumeId = req.resumeId as string | undefined;
      const cwd = req.cwd as string | undefined;
      const limitLines = typeof req.limitLines === "number" ? req.limitLines : undefined;

      if (id) {
        const session = sm.getSession(id);
        if (!session) return { ok: false, error: `Session ${id} not found` };
        const history = readHistoryForDaemonSession(session, limitLines);
        return { ok: true, history };
      }

      if (!tool || !resumeId) {
        return { ok: false, error: "Missing required: id or (tool, resumeId)" };
      }
      if (tool !== "claude" && tool !== "codex") {
        return { ok: false, error: "Invalid tool. Expected claude or codex." };
      }

      const history = await readHistoryForNativeSession({ tool, resumeId, cwd, limitLines });
      return { ok: true, history };
    }

    case "session.wait_idle": {
      const id = req.id as string | undefined;
      const timeoutMs = typeof req.timeoutMs === "number" ? req.timeoutMs : undefined;
      if (!id) return { ok: false, error: "Missing required: id" };
      return await sm.waitForIdle(id, timeoutMs);
    }

    case "session.remove": {
      const id = req.id as string | undefined;
      if (!id) return { ok: false, error: "Missing required: id" };
      const removed = sm.removeSession(id);
      if (!removed) return { ok: false, error: `Session ${id} not found` };
      return { ok: true };
    }

    case "stop": {
      log("Received stop command via IPC");
      // Respond first, then exit
      setTimeout(async () => {
        await sm.shutdownAll();
        process.exit(0);
      }, 100);
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown command: ${req.cmd}` };
  }
}

// ── Client (runs in CLI process) ──

export function sendCommand(req: IpcRequest): Promise<IpcResponse> {
  const sockPath = socketPath();

  return new Promise((resolve, reject) => {
    const conn = net.createConnection(sockPath, () => {
      conn.write(JSON.stringify(req) + "\n");
    });

    let data = "";
    conn.on("data", (chunk) => {
      data += chunk.toString();
    });

    conn.on("end", () => {
      try {
        resolve(JSON.parse(data) as IpcResponse);
      } catch {
        reject(new Error("Invalid response from daemon"));
      }
    });

    conn.on("error", (err) => {
      reject(err);
    });

    // Timeout after 10s
    conn.setTimeout(10000, () => {
      conn.destroy();
      reject(new Error("IPC connection timeout"));
    });
  });
}

export function cleanupSocket(): void {
  try {
    fs.unlinkSync(socketPath());
  } catch {
    // ignore
  }
}
