import type { NativeSshClient } from "../ssh/nativeSsh";
import type { SshCredentials, TargetProfile } from "../types";

export interface DaemonSessionInfo {
  id: string;
  tool: string;
  status: string;
  conversationId?: string;
  workingDirectory?: string;
  model?: string;
  outputLines: number;
  outputBytes: number;
  pid?: number;
  createdAt?: string;
  updatedAt?: string;
  lastTurn?: {
    prompt: string;
    startedAt: string;
    endedAt?: string;
    exitCode?: number;
    error?: string;
  };
}

export interface WorkspaceChatInfo {
  id: string;
  origin: "daemon" | "native";
  tool: "claude" | "codex";
  status: string;
  workingDirectory: string;
  resumeId: string;
  conversationId?: string;
  daemonSessionId?: string;
  model?: string;
  outputLines: number;
  outputBytes: number;
  pid?: number;
  createdAt?: string;
  updatedAt?: string;
  title?: string;
  summary?: string;
  messageCount?: number;
  lastTurn?: {
    prompt: string;
    startedAt: string;
    endedAt?: string;
    exitCode?: number;
    error?: string;
  };
}

export interface DaemonOutputLine {
  /** "o" = stdout, "e" = stderr, "m" = meta */
  t: "o" | "e" | "m";
  ts: number;
  line?: string;
  event?: "turn_start" | "turn_end" | "error";
  prompt?: string;
  exitCode?: number;
  error?: string;
}

export interface SessionHistoryPayload {
  source: "daemon" | "native";
  tool: "claude" | "codex" | "gemini";
  format: "daemon_output_jsonl" | "native_claude_jsonl" | "native_codex_jsonl";
  lines: string[];
  lineCount: number;
  truncated: boolean;
}

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

function parseIpcResponse(stdout: string): Record<string, unknown> {
  const cleaned = stripAnsi(stdout).trim();
  // Find the last JSON object in stdout (skip any shell prompt noise)
  const lines = cleaned.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.startsWith("{")) {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
  }
  throw new Error("No valid JSON response from daemon");
}

export class DaemonTransport {
  constructor(private readonly ssh: NativeSshClient) {}

  async createSession(
    target: TargetProfile,
    credentials: SshCredentials,
    opts: {
      tool: string;
      cwd: string;
      model?: string;
      autoAccept?: boolean;
      conversationId?: string;
    },
  ): Promise<{ daemonSessionId: string }> {
    const parts = [
      "openvide-daemon", "session", "create",
      "--tool", escapeShellArg(opts.tool),
      "--cwd", escapeShellArg(opts.cwd),
    ];
    if (opts.model) {
      parts.push("--model", escapeShellArg(opts.model));
    }
    if (opts.autoAccept) {
      parts.push("--auto-accept");
    }
    if (opts.conversationId) {
      parts.push("--conversation-id", escapeShellArg(opts.conversationId));
    }

    const stdout = await this.execDaemonCommand(target, credentials, parts.join(" "));
    const resp = parseIpcResponse(stdout);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon session create failed");
    }
    const session = resp["session"] as Record<string, unknown> | undefined;
    if (!session?.["id"]) {
      throw new Error("Daemon returned no session ID");
    }
    return { daemonSessionId: session["id"] as string };
  }

  async sendTurn(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    prompt: string,
  ): Promise<void> {
    const cmd = [
      "openvide-daemon", "session", "send",
      "--id", escapeShellArg(daemonSessionId),
      "--prompt", escapeShellArg(prompt),
    ].join(" ");

    const stdout = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(stdout);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon send failed");
    }
  }

  /**
   * Streams daemon output via SSH. Calls onLine for each JSONL line.
   * Returns the new output offset (number of lines consumed).
   */
  async streamOutput(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    offset: number,
    onLine: (parsed: DaemonOutputLine) => void,
    signal?: { cancelled: boolean },
  ): Promise<number> {
    const cmd = [
      "openvide-daemon", "session", "stream",
      "--id", escapeShellArg(daemonSessionId),
      "--offset", String(offset),
      "--follow",
    ].join(" ");

    let lineCount = offset;
    let stdoutBuffer = "";
    let resolveStream: (() => void) | undefined;
    const streamDone = new Promise<void>((resolve) => {
      resolveStream = resolve;
    });

    const handle = await this.ssh.runCommand(
      target,
      credentials,
      cmd,
      {
        onStdout: (chunk: string) => {
          stdoutBuffer += stripAnsi(chunk);
          let newline = stdoutBuffer.indexOf("\n");
          while (newline !== -1) {
            const line = stdoutBuffer.slice(0, newline);
            stdoutBuffer = stdoutBuffer.slice(newline + 1);
            newline = stdoutBuffer.indexOf("\n");
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;
            if (signal?.cancelled) continue;

            try {
              const parsed = JSON.parse(trimmed) as DaemonOutputLine;
              lineCount++;
              onLine(parsed);

              // turn_end signals the stream is done
              if (parsed.t === "m" && parsed.event === "turn_end") {
                resolveStream?.();
              }
            } catch {
              // Non-JSON line (shell noise), skip
              console.warn("[OV:daemon] non-JSON stream line:", trimmed.slice(0, 100));
            }
          }
        },
        onStderr: (chunk: string) => {
          if (chunk.trim().length > 0) {
            console.warn("[OV:daemon] stream stderr:", chunk.slice(0, 200));
          }
        },
      },
      { mode: "scripted" },
    );

    // Wait for turn_end or SSH exit (whichever comes first)
    const result = await Promise.race([
      handle.wait,
      streamDone.then(async () => {
        // Give a moment then cancel the follow stream
        await new Promise<void>((r) => setTimeout(r, 1000));
        try { await handle.cancel(); } catch { /* no-op */ }
        return { exitCode: 0 as number | null, stdout: "", stderr: "" };
      }),
      // Safety timeout: 5 minutes
      new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
        setTimeout(() => {
          console.warn("[OV:daemon] stream safety timeout for", daemonSessionId);
          try { handle.cancel().catch(() => {}); } catch { /* no-op */ }
          resolve({ exitCode: null, stdout: "", stderr: "" });
        }, 300000);
      }),
    ]);

    if (signal?.cancelled) {
      try { await handle.cancel(); } catch { /* no-op */ }
    }

    const trailing = stdoutBuffer.trim();
    if (trailing.length > 0 && !signal?.cancelled) {
      try {
        const parsed = JSON.parse(trailing) as DaemonOutputLine;
        lineCount++;
        onLine(parsed);
      } catch {
        // ignore incomplete/non-JSON trailing chunk
      }
    }

    // Non-zero exit that isn't from our cancel
    if (result.exitCode && result.exitCode !== 0 && result.exitCode !== 130) {
      console.warn("[OV:daemon] stream exited with code", result.exitCode);
    }

    return lineCount;
  }

  async getHistory(
    target: TargetProfile,
    credentials: SshCredentials,
    opts: {
      daemonSessionId?: string;
      tool?: "claude" | "codex";
      resumeId?: string;
      cwd?: string;
      limitLines?: number;
    },
  ): Promise<SessionHistoryPayload> {
    const parts = ["openvide-daemon", "session", "history"];
    if (opts.daemonSessionId) {
      parts.push("--id", escapeShellArg(opts.daemonSessionId));
    } else {
      if (!opts.tool || !opts.resumeId) {
        throw new Error("History request requires daemonSessionId or (tool and resumeId)");
      }
      parts.push("--tool", escapeShellArg(opts.tool));
      parts.push("--resume-id", escapeShellArg(opts.resumeId));
      if (opts.cwd) {
        parts.push("--cwd", escapeShellArg(opts.cwd));
      }
    }
    if (opts.limitLines && Number.isFinite(opts.limitLines)) {
      parts.push("--limit-lines", String(Math.max(1, Math.floor(opts.limitLines))));
    }

    const stdout = await this.execDaemonCommand(target, credentials, parts.join(" "));
    const resp = parseIpcResponse(stdout);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon history failed");
    }
    return resp["history"] as SessionHistoryPayload;
  }

  async waitUntilIdle(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    timeoutMs = 120000,
  ): Promise<{ timedOut: boolean }> {
    const cmd = [
      "openvide-daemon", "session", "wait-idle",
      "--id", escapeShellArg(daemonSessionId),
      "--timeout-ms", String(Math.max(1000, Math.floor(timeoutMs))),
    ].join(" ");
    const stdout = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(stdout);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon wait-idle failed");
    }
    return { timedOut: resp["timedOut"] === true };
  }

  async cancelTurn(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
  ): Promise<void> {
    const cmd = [
      "openvide-daemon", "session", "cancel",
      "--id", escapeShellArg(daemonSessionId),
    ].join(" ");

    const stdout = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(stdout);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon cancel failed");
    }
  }

  async getSession(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
  ): Promise<DaemonSessionInfo> {
    const cmd = [
      "openvide-daemon", "session", "get",
      "--id", escapeShellArg(daemonSessionId),
    ].join(" ");

    const stdout = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(stdout);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon get session failed");
    }
    return resp["session"] as unknown as DaemonSessionInfo;
  }

  async listSessions(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<DaemonSessionInfo[]> {
    const cmd = "openvide-daemon session list";
    const stdout = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(stdout);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon list sessions failed");
    }
    const sessions = resp["sessions"];
    if (!Array.isArray(sessions)) {
      return [];
    }
    return sessions as unknown as DaemonSessionInfo[];
  }

  async listWorkspaceSessions(
    target: TargetProfile,
    credentials: SshCredentials,
    cwd: string,
  ): Promise<WorkspaceChatInfo[]> {
    const cmd = [
      "openvide-daemon", "session", "list-workspace",
      "--cwd", escapeShellArg(cwd),
    ].join(" ");
    const stdout = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(stdout);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon list workspace sessions failed");
    }
    const sessions = resp["sessions"];
    if (!Array.isArray(sessions)) {
      return [];
    }
    return sessions as unknown as WorkspaceChatInfo[];
  }

  private async execDaemonCommand(
    target: TargetProfile,
    credentials: SshCredentials,
    command: string,
  ): Promise<string> {
    console.log("[OV:daemon] exec:", command.slice(0, 200));

    const handle = await this.ssh.runCommand(
      target,
      credentials,
      command,
      {
        onStdout: () => {},
        onStderr: (chunk: string) => {
          if (chunk.trim().length > 0) {
            console.warn("[OV:daemon] stderr:", chunk.slice(0, 200));
          }
        },
      },
      { mode: "scripted" },
    );

    const result = await Promise.race([
      handle.wait,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Daemon command timed out")), 30000);
      }),
    ]);

    return result.stdout;
  }
}
