import { NativeSshClient, type SshRunResult } from "../ssh/nativeSsh";
import type { SshCredentials, TargetProfile } from "../types";
import type { Transport, ScheduledTask, ScheduleDraft, TeamInfo, TeamTaskInfo, TeamMessageInfo, TeamPlanInfo, TeamMemberInput, TeamPlanInput, TeamPlanSubmitOpts, BridgeRuntimeConfig, FollowUpSuggestion } from "./Transport";

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
  tool: "claude" | "codex" | "gemini";
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

export interface CodexModelInfo {
  id: string;
  displayName: string;
  hidden: boolean;
  isDefault: boolean;
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

interface DaemonCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

interface DaemonExecOptions {
  conflictPolicy?: "queue" | "preempt";
  timeoutMs?: number;
}

function tryParseJsonLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  // Fast path: entire line is JSON.
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Keep trying.
  }

  // Shells can prepend/append prompt noise around JSON.
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    } catch {
      // Keep trying.
    }
  }
  return undefined;
}

function parseIpcResponse(output: DaemonCommandResult): Record<string, unknown> {
  const combined = [output.stdout, output.stderr]
    .map((chunk) => stripAnsi(chunk).trim())
    .filter((chunk) => chunk.length > 0)
    .join("\n");

  const lines = combined.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = tryParseJsonLine(lines[i] ?? "");
    if (parsed) {
      return parsed;
    }
  }

  const stderrTail = stripAnsi(output.stderr).trim().split("\n").slice(-2).join(" | ");
  const suffix = stderrTail ? ` (stderr: ${stderrTail})` : "";
  throw new Error(`No valid JSON response from daemon${suffix}`);
}

export class DaemonTransport implements Transport {
  private static readonly DEFAULT_DAEMON_TIMEOUT_MS = 30000;
  private static readonly LONG_CMD_TIMEOUT_MS = 60000;
  private static readonly DAEMON_CMD = "openvide-daemon";
  private static readonly DAEMON_NOT_FOUND_JSON = "{\"ok\":false,\"error\":\"openvide-daemon not found in PATH or common install paths\"}";

  private readonly streamSsh: NativeSshClient;
  // Cache resolved daemon binary path per target so subsequent commands
  // skip the expensive multi-line shell resolution (~500 bytes).
  private readonly resolvedDaemonBin = new Map<string, string>();

  constructor(private readonly ssh: NativeSshClient, streamSsh?: NativeSshClient) {
    // Streaming uses a dedicated SSH connection so long-running
    // `session stream --follow` commands never block the main queue.
    this.streamSsh = streamSsh ?? new NativeSshClient();
  }

  /**
   * Drop all cached SSH connections (main + streaming).
   * Call this when the app returns to foreground after backgrounding,
   * since iOS/Android kill idle TCP sockets while the app is suspended.
   */
  async resetAllConnections(): Promise<void> {
    __DEV__ && console.log("[OV:transport] resetAllConnections START (app foregrounded)");
    this.resolvedDaemonBin.clear();
    await Promise.all([
      this.ssh.dispose().catch(() => {}),
      this.streamSsh.dispose().catch(() => {}),
    ]);
    __DEV__ && console.log("[OV:transport] resetAllConnections DONE");
  }

  /**
   * Resolve the daemon binary path once per target via a small SSH command,
   * then cache it so every subsequent command is just `'/path/to/bin' <args>`
   * (~150 bytes) instead of the full resolution script (~900 bytes).
   * This avoids hitting SSH PTY input buffer limits on long commands.
   */
  private async ensureDaemonBinCached(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<void> {
    if (this.resolvedDaemonBin.has(target.id)) return;

    // Short script (~450 bytes) that only resolves and prints the path
    const resolveScript = [
      "OV_DAEMON_BIN=\"$(command -v openvide-daemon 2>/dev/null || true)\"",
      "if [ -z \"$OV_DAEMON_BIN\" ]; then",
      "  for C in \"$HOME/.npm-global/bin/openvide-daemon\" \"$HOME/.local/bin/openvide-daemon\" \"/opt/homebrew/bin/openvide-daemon\" \"/usr/local/bin/openvide-daemon\"; do",
      "    [ -x \"$C\" ] && OV_DAEMON_BIN=\"$C\" && break",
      "  done",
      "fi",
      "if [ -z \"$OV_DAEMON_BIN\" ] && [ -d \"$HOME/.nvm/versions/node\" ]; then",
      "  OV_DAEMON_BIN=\"$(find \"$HOME/.nvm/versions/node\" -type f -path '*/bin/openvide-daemon' 2>/dev/null | sort | tail -n 1)\"",
      "fi",
      "echo \"__OV_BIN:${OV_DAEMON_BIN:-NOT_FOUND}\"",
    ].join("\n");

    __DEV__ && console.log(`[OV:transport] ensureDaemonBinCached: resolving for ${target.id.slice(0, 12)}`);
    let handle: Awaited<ReturnType<typeof this.ssh.runCommand>>;
    try {
      handle = await this.ssh.runCommand(
        target, credentials, resolveScript,
        { onStdout: () => {}, onStderr: () => {} },
        { mode: "scripted", conflictPolicy: "queue" },
      );
    } catch (err) {
      __DEV__ && console.log(`[OV:transport] ensureDaemonBinCached: SSH connect failed for ${target.id.slice(0, 12)}, resetting`);
      await this.ssh.resetTargetSession(target.id).catch(() => {});
      throw err;
    }

    let result: SshRunResult;
    try {
      result = await Promise.race([
        handle.wait,
        new Promise<never>((_, reject) =>
          setTimeout(() => { handle.cancel().catch(() => {}); reject(new Error("Daemon binary resolve timed out")); }, 10000),
        ),
      ]);
    } catch (err) {
      // On timeout, reset the SSH session so subsequent commands don't queue behind a stuck shell
      __DEV__ && console.log(`[OV:transport] ensureDaemonBinCached: timed out for ${target.id.slice(0, 12)}, resetting SSH session`);
      await this.ssh.resetTargetSession(target.id).catch(() => {});
      throw err;
    }

    // Match only lines where __OV_BIN: is followed by an absolute path (starts with /).
    // PTY echoes back the raw command text (containing ${OV_DAEMON_BIN:-NOT_FOUND}),
    // so we must skip those echo lines and only pick up the actual resolved path.
    const binMatch = stripAnsi(result.stdout).match(/__OV_BIN:(\/[^\s"']+)/);
    const binPath = binMatch?.[1]?.trim();
    if (binPath && binPath.length > 0) {
      __DEV__ && console.log(`[OV:transport] ensureDaemonBinCached: resolved ${target.id.slice(0, 12)} → ${binPath}`);
      this.resolvedDaemonBin.set(target.id, binPath);
    } else {
      __DEV__ && console.log(`[OV:transport] ensureDaemonBinCached: NOT FOUND for ${target.id.slice(0, 12)}`);
      // Don't cache — let the actual command fail with a proper error
    }
  }

  private withResolvedDaemonBinary(command: string, targetId?: string): string {
    const trimmed = command.trim();
    const prefix = `${DaemonTransport.DAEMON_CMD} `;
    if (!trimmed.startsWith(prefix)) {
      return trimmed;
    }

    const args = trimmed.slice(prefix.length);

    // Use cached binary path (should always be available after ensureDaemonBinCached)
    const cached = targetId ? this.resolvedDaemonBin.get(targetId) : undefined;
    if (cached) {
      return `${escapeShellArg(cached)} ${args}`;
    }

    // Fallback: full resolution script (only used if ensureDaemonBinCached wasn't called)
    return [
      "OV_DAEMON_BIN=\"$(command -v openvide-daemon 2>/dev/null || true)\"",
      "if [ -z \"$OV_DAEMON_BIN\" ]; then",
      "  for C in \"$HOME/.npm-global/bin/openvide-daemon\" \"$HOME/.local/bin/openvide-daemon\" \"/opt/homebrew/bin/openvide-daemon\" \"/usr/local/bin/openvide-daemon\"; do",
      "    [ -x \"$C\" ] && OV_DAEMON_BIN=\"$C\" && break",
      "  done",
      "fi",
      "if [ -z \"$OV_DAEMON_BIN\" ] && [ -d \"$HOME/.nvm/versions/node\" ]; then",
      "  OV_DAEMON_BIN=\"$(find \"$HOME/.nvm/versions/node\" -type f -path '*/bin/openvide-daemon' 2>/dev/null | sort | tail -n 1)\"",
      "fi",
      "if [ -z \"$OV_DAEMON_BIN\" ]; then",
      `  echo ${escapeShellArg(DaemonTransport.DAEMON_NOT_FOUND_JSON)}`,
      "  exit 127",
      "fi",
      `"$OV_DAEMON_BIN" ${args}`,
    ].join("\n");
  }

  async createSession(
    target: TargetProfile,
    credentials: SshCredentials,
    opts: {
      tool: string;
      cwd: string;
      model?: string;
      conversationId?: string;
    },
  ): Promise<{ daemonSessionId: string }> {
    __DEV__ && console.log(`[OV:transport] createSession tool=${opts.tool} cwd=${opts.cwd.slice(-30)}`);
    const parts = [
      "openvide-daemon", "session", "create",
      "--tool", escapeShellArg(opts.tool),
      "--cwd", escapeShellArg(opts.cwd),
      "--auto-accept",
    ];
    if (opts.model) {
      parts.push("--model", escapeShellArg(opts.model));
    }
    if (opts.conversationId) {
      parts.push("--conversation-id", escapeShellArg(opts.conversationId));
    }

    const daemonOutput = await this.execDaemonCommand(target, credentials, parts.join(" "));
    const resp = parseIpcResponse(daemonOutput);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon session create failed");
    }
    const session = resp["session"] as Record<string, unknown> | undefined;
    if (!session?.["id"]) {
      throw new Error("Daemon returned no session ID");
    }
    __DEV__ && console.log(`[OV:transport] createSession OK id=${session["id"]}`);
    return { daemonSessionId: session["id"] as string };
  }

  async sendTurn(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    prompt: string,
    options?: { mode?: string; model?: string },
  ): Promise<void> {
    __DEV__ && console.log(`[OV:transport] sendTurn id=${daemonSessionId} prompt=${prompt.slice(0, 40)}...`);
    const parts = [
      "openvide-daemon", "session", "send",
      "--id", escapeShellArg(daemonSessionId),
      "--prompt", escapeShellArg(prompt),
    ];
    if (options?.mode) {
      parts.push("--mode", escapeShellArg(options.mode));
    }
    if (options?.model) {
      parts.push("--model", escapeShellArg(options.model));
    }
    const cmd = parts.join(" ");

    const daemonOutput = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(daemonOutput);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon send failed");
    }
    __DEV__ && console.log(`[OV:transport] sendTurn OK`);
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
    const rawCmd = [
      "openvide-daemon", "session", "stream",
      "--id", escapeShellArg(daemonSessionId),
      "--offset", String(offset),
      "--follow",
    ].join(" ");
    // Ensure binary is resolved before building the stream command.
    // Uses the main SSH connection for the resolve, then streamSsh for the actual stream.
    await this.ensureDaemonBinCached(target, credentials);
    const cmd = this.withResolvedDaemonBinary(rawCmd, target.id);

    let lineCount = offset;
    let stdoutBuffer = "";
    let resolveStream: (() => void) | undefined;
    const streamDone = new Promise<void>((resolve) => {
      resolveStream = resolve;
    });

    // Use dedicated streaming SSH connection so we never block the main queue.
    const handle = await this.streamSsh.runCommand(
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
            }
          }
        },
        onStderr: () => {},
      },
      { mode: "scripted", conflictPolicy: "queue" },
    );

    // Build a promise that resolves when signal.cancelled becomes true.
    // This is added to Promise.race so the stream exits promptly on detach
    // and properly awaits handle.cancel() to free the SSH queue.
    const signalAborted = signal
      ? new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
          const check = setInterval(() => {
            if (signal.cancelled) {
              clearInterval(check);
              handle.cancel()
                .catch(() => {})
                .then(() => resolve({ exitCode: 130, stdout: "", stderr: "" }));
            }
          }, 250);
          // Clean up interval when stream finishes naturally
          handle.wait.finally(() => clearInterval(check));
        })
      : new Promise<never>(() => {}); // never resolves

    // Wait for turn_end, SSH exit, signal abort, or safety timeout
    const result = await Promise.race([
      handle.wait,
      streamDone.then(async () => {
        // Give a moment then cancel the follow stream
        await new Promise<void>((r) => setTimeout(r, 1000));
        try { await handle.cancel(); } catch { /* no-op */ }
        return { exitCode: 0 as number | null, stdout: "", stderr: "" };
      }),
      signalAborted,
      // Safety timeout: 5 minutes
      new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
        setTimeout(() => {
          handle.cancel().catch(() => {});
          resolve({ exitCode: null, stdout: "", stderr: "" });
        }, 300000);
      }),
    ]);

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
    // Non-zero exit that isn't from our cancel — silently ignored

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

    const daemonOutput = await this.execDaemonCommand(
      target, credentials, parts.join(" "),
      { timeoutMs: DaemonTransport.LONG_CMD_TIMEOUT_MS },
    );
    const resp = parseIpcResponse(daemonOutput);
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
    // SSH timeout must exceed the daemon-side wait + some buffer
    const sshTimeout = Math.max(DaemonTransport.LONG_CMD_TIMEOUT_MS, timeoutMs + 10000);
    const daemonOutput = await this.execDaemonCommand(
      target, credentials, cmd,
      { timeoutMs: sshTimeout },
    );
    const resp = parseIpcResponse(daemonOutput);
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

    const daemonOutput = await this.execDaemonCommand(
      target,
      credentials,
      cmd,
      { conflictPolicy: "preempt" },
    );
    const resp = parseIpcResponse(daemonOutput);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon cancel failed");
    }
  }

  async removeSession(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
  ): Promise<void> {
    const cmd = [
      "openvide-daemon", "session", "remove",
      "--id", escapeShellArg(daemonSessionId),
    ].join(" ");
    const daemonOutput = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(daemonOutput);
    if (!resp["ok"]) {
      const error = (resp["error"] as string) ?? "";
      if (!error.includes("not found")) {
        throw new Error(error || "Daemon remove session failed");
      }
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

    const daemonOutput = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(daemonOutput);
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
    const daemonOutput = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(daemonOutput);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon list sessions failed");
    }
    const sessions = resp["sessions"];
    if (!Array.isArray(sessions)) {
      return [];
    }
    return sessions as unknown as DaemonSessionInfo[];
  }

  async listSessionCatalog(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<WorkspaceChatInfo[]> {
    const cmd = "openvide-daemon session catalog";
    const daemonOutput = await this.execDaemonCommand(
      target,
      credentials,
      cmd,
      { timeoutMs: DaemonTransport.LONG_CMD_TIMEOUT_MS },
    );
    const resp = parseIpcResponse(daemonOutput);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon session catalog failed");
    }
    const sessions = resp["sessions"];
    if (!Array.isArray(sessions)) {
      return [];
    }
    return sessions as unknown as WorkspaceChatInfo[];
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
    const daemonOutput = await this.execDaemonCommand(
      target, credentials, cmd,
    );
    const resp = parseIpcResponse(daemonOutput);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon list workspace sessions failed");
    }
    const sessions = resp["sessions"];
    if (!Array.isArray(sessions)) {
      return [];
    }
    return sessions as unknown as WorkspaceChatInfo[];
  }

  async listCodexModels(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<CodexModelInfo[]> {
    const parseModels = (rawModels: unknown): CodexModelInfo[] => {
      const rows = Array.isArray(rawModels) ? rawModels : [];
      const seen = new Set<string>();
      const models: CodexModelInfo[] = [];
      for (const row of rows) {
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
    };

    // Preferred path: short daemon command (stable over SSH PTY limits).
    try {
      const daemonOutput = await this.execDaemonCommand(
        target,
        credentials,
        "openvide-daemon model list --tool codex",
        { timeoutMs: DaemonTransport.LONG_CMD_TIMEOUT_MS },
      );
      const resp = parseIpcResponse(daemonOutput);
      if (resp["ok"] === true) {
        const models = parseModels(resp["models"]);
        if (models.length > 0) {
          return models;
        }
      } else {
        const error = typeof resp["error"] === "string" ? resp["error"] : "codex_model_list_failed";
        throw new Error(error);
      }
    } catch (error) {
      __DEV__ && console.log(`[OV:transport] listCodexModels daemon path failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Fallback for older daemon builds without `model list`.
    const fallbackProbe = [
      "if ! command -v codex >/dev/null 2>&1; then echo '{\"ok\":false,\"error\":\"codex_not_found\"}'; exit 0; fi",
      "if ! command -v node >/dev/null 2>&1; then echo '{\"ok\":false,\"error\":\"node_not_found\"}'; exit 0; fi",
      "node -e 'const{spawn}=require(\"child_process\");const p=spawn(\"codex\",[\"app-server\",\"--listen\",\"stdio://\"],{stdio:[\"pipe\",\"pipe\",\"ignore\"]});let b=\"\",d=0;const f=(x)=>{if(d)return;d=1;__DEV__ && console.log(JSON.stringify(x));try{p.kill(\"SIGTERM\")}catch{}};setTimeout(()=>f({ok:false,error:\"model_list_timeout\"}),15000);p.on(\"error\",e=>f({ok:false,error:String((e&&e.message)||e)}));p.on(\"exit\",c=>f({ok:false,error:`app_server_exit_${c==null?\"null\":c}`}));p.stdout.on(\"data\",ch=>{b+=ch.toString(\"utf8\");for(;;){const i=b.indexOf(\"\\\\n\");if(i<0)break;const l=b.slice(0,i).trim();b=b.slice(i+1);if(!l)continue;let m;try{m=JSON.parse(l)}catch{continue}if(m&&m.id===1){p.stdin.write(\"{\\\\\"id\\\\\":2,\\\\\"method\\\\\":\\\\\"model/list\\\\\",\\\\\"params\\\\\":{\\\\\"limit\\\\\":200}}\\\\n\");continue}if(m&&m.id===2){const arr=Array.isArray(m.result&&m.result.data)?m.result.data:[];f({ok:true,models:arr.map(x=>({id:typeof x.id===\\\\\"string\\\\\"?x.id:\\\\\"\\\\\",displayName:typeof x.displayName===\\\\\"string\\\\\"&&x.displayName?x.displayName:(typeof x.id===\\\\\"string\\\\\"?x.id:\\\\\"\\\\\"),hidden:x.hidden===true,isDefault:x.isDefault===true})).filter(x=>x.id)});return}}});p.stdin.write(\"{\\\\\"id\\\\\":1,\\\\\"method\\\\\":\\\\\"initialize\\\\\",\\\\\"params\\\\\":{\\\\\"clientInfo\\\\\":{\\\\\"name\\\\\":\\\\\"openvide\\\\\",\\\\\"version\\\\\":\\\\\"0.1.0\\\\\"},\\\\\"capabilities\\\\\":{}}}\\\\n\");'",
    ].join("\n");
    const result = await this.runSshCommand(target, credentials, fallbackProbe, 30000);
    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed["ok"] !== true) {
        continue;
      }
      const models = parseModels(parsed["models"]);
      if (models.length > 0) {
        return models;
      }
    }

    throw new Error("No valid codex model list response");
  }

  async sessionSuggest(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    limit = 4,
  ): Promise<FollowUpSuggestion[]> {
    const cmd = [
      "openvide-daemon", "session", "suggest",
      "--id", escapeShellArg(daemonSessionId),
      "--limit", String(limit),
    ].join(" ");
    const daemonOutput = await this.execDaemonCommand(target, credentials, cmd, {
      timeoutMs: DaemonTransport.LONG_CMD_TIMEOUT_MS,
    });
    const resp = parseIpcResponse(daemonOutput);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Daemon suggest failed");
    }
    const suggestions = resp["suggestions"];
    return Array.isArray(suggestions) ? (suggestions as FollowUpSuggestion[]) : [];
  }

  async runSshCommand(
    target: TargetProfile,
    credentials: SshCredentials,
    command: string,
    timeoutMs = 15000,
  ): Promise<{ stdout: string; exitCode: number }> {
    const handle = await this.ssh.runCommand(
      target,
      credentials,
      command,
      {
        onStdout: () => {},
        onStderr: () => {},
      },
      { mode: "scripted", conflictPolicy: "queue" },
    );
    try {
      const result = await Promise.race([
        handle.wait,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("SSH command timed out")), timeoutMs),
        ),
      ]);
      return { stdout: stripAnsi(result.stdout), exitCode: result.exitCode ?? 1 };
    } catch (err) {
      handle.cancel().catch(() => {});
      throw err;
    }
  }

  /**
   * Register an Expo push token with the daemon on this target.
   * Best-effort: catches errors, logs, doesn't throw.
   */
  async registerPushToken(
    target: TargetProfile,
    credentials: SshCredentials,
    token: string,
  ): Promise<void> {
    try {
      const cmd = [
        "openvide-daemon", "config", "set-push-token",
        "--token", escapeShellArg(token),
      ].join(" ");
      const daemonOutput = await this.execDaemonCommand(target, credentials, cmd);
      const resp = parseIpcResponse(daemonOutput);
      if (!resp["ok"]) {
        __DEV__ && console.log(`[OV:transport] registerPushToken failed: ${resp["error"] ?? "unknown"}`);
      } else {
        __DEV__ && console.log(`[OV:transport] registerPushToken OK for ${target.id.slice(0, 12)}`);
      }
    } catch (err) {
      __DEV__ && console.log(`[OV:transport] registerPushToken error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async bridgeConfigGet(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<BridgeRuntimeConfig> {
    const cmd = "openvide-daemon bridge config";
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Bridge config get failed");
    }
    return resp["bridgeConfig"] as BridgeRuntimeConfig;
  }

  async bridgeConfigUpdate(
    target: TargetProfile,
    credentials: SshCredentials,
    updates: Partial<BridgeRuntimeConfig>,
  ): Promise<BridgeRuntimeConfig> {
    const cmd = ["openvide-daemon", "bridge", "config"];
    if (updates.defaultCwd !== undefined) {
      cmd.push("--default-cwd", escapeShellArg(updates.defaultCwd));
    }
    if (updates.evenAiTool) {
      cmd.push("--even-ai-tool", updates.evenAiTool);
    }
    if (updates.evenAiMode) {
      cmd.push("--even-ai-mode", updates.evenAiMode);
    }
    if (updates.evenAiPinnedSessionId !== undefined) {
      cmd.push("--even-ai-pin-session", escapeShellArg(updates.evenAiPinnedSessionId));
    }
    const result = await this.execDaemonCommand(target, credentials, cmd.join(" "));
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Bridge config update failed");
    }
    return resp["bridgeConfig"] as BridgeRuntimeConfig;
  }

  // ── Remote + Schedule commands ──

  async sessionRemote(
    target: TargetProfile,
    credentials: SshCredentials,
    sessionId: string,
  ): Promise<{ remoteUrl: string }> {
    const cmd = `openvide-daemon session remote --id ${escapeShellArg(sessionId)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Remote failed");
    }
    return { remoteUrl: resp["remoteUrl"] as string };
  }

  async scheduleList(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<ScheduledTask[]> {
    const cmd = "openvide-daemon schedule list";
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Schedule list failed");
    }
    return (resp["schedules"] as ScheduledTask[]) ?? [];
  }

  async scheduleGet(
    target: TargetProfile,
    credentials: SshCredentials,
    scheduleId: string,
  ): Promise<ScheduledTask> {
    const cmd = `openvide-daemon schedule get --id ${escapeShellArg(scheduleId)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Schedule get failed");
    }
    return resp["schedule"] as ScheduledTask;
  }

  async scheduleCreate(
    target: TargetProfile,
    credentials: SshCredentials,
    schedule: ScheduleDraft,
  ): Promise<ScheduledTask> {
    const cmd = [
      "openvide-daemon", "schedule", "create",
      "--name", escapeShellArg(schedule.name),
      "--schedule", escapeShellArg(schedule.schedule),
      "--target-json", escapeShellArg(JSON.stringify(schedule.target)),
    ];
    if (schedule.project) {
      cmd.push("--project", escapeShellArg(schedule.project));
    }
    if (schedule.enabled !== undefined) {
      cmd.push("--enabled", schedule.enabled ? "true" : "false");
    }
    const result = await this.execDaemonCommand(target, credentials, cmd.join(" "));
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Schedule create failed");
    }
    return resp["schedule"] as ScheduledTask;
  }

  async scheduleUpdate(
    target: TargetProfile,
    credentials: SshCredentials,
    scheduleId: string,
    updates: Partial<ScheduleDraft>,
  ): Promise<ScheduledTask> {
    const cmd = [
      "openvide-daemon", "schedule", "update",
      "--id", escapeShellArg(scheduleId),
    ];
    if (updates.name) cmd.push("--name", escapeShellArg(updates.name));
    if (updates.schedule) cmd.push("--schedule", escapeShellArg(updates.schedule));
    if (updates.project) cmd.push("--project", escapeShellArg(updates.project));
    if (updates.enabled !== undefined) cmd.push("--enabled", updates.enabled ? "true" : "false");
    if (updates.target) cmd.push("--target-json", escapeShellArg(JSON.stringify(updates.target)));
    const result = await this.execDaemonCommand(target, credentials, cmd.join(" "));
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Schedule update failed");
    }
    return resp["schedule"] as ScheduledTask;
  }

  async scheduleDelete(
    target: TargetProfile,
    credentials: SshCredentials,
    scheduleId: string,
  ): Promise<void> {
    const cmd = `openvide-daemon schedule delete --id ${escapeShellArg(scheduleId)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Schedule delete failed");
    }
  }

  async scheduleRun(
    target: TargetProfile,
    credentials: SshCredentials,
    taskId: string,
  ): Promise<void> {
    const cmd = `openvide-daemon schedule run --task-id ${escapeShellArg(taskId)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd, { timeoutMs: 60000 });
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) {
      throw new Error((resp["error"] as string) ?? "Schedule run failed");
    }
  }

  // ── Channel commands ──

  // ── Team commands ──

  async teamCreate(
    target: TargetProfile,
    credentials: SshCredentials,
    opts: { name: string; cwd: string; members: TeamMemberInput[] },
  ): Promise<TeamInfo> {
    const cmd = `openvide-daemon team create --name ${escapeShellArg(opts.name)} --cwd ${escapeShellArg(opts.cwd)} --members ${escapeShellArg(JSON.stringify(opts.members))}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team create failed");
    return resp["team"] as unknown as TeamInfo;
  }

  async teamList(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<TeamInfo[]> {
    const cmd = "openvide-daemon team list";
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team list failed");
    return (resp["teams"] as TeamInfo[]) ?? [];
  }

  async teamGet(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
  ): Promise<TeamInfo> {
    const cmd = `openvide-daemon team get --team-id ${escapeShellArg(teamId)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team get failed");
    return resp["team"] as unknown as TeamInfo;
  }

  async teamUpdate(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    updates: { name?: string; cwd?: string; members?: TeamMemberInput[] },
  ): Promise<TeamInfo> {
    const parts = [
      "openvide-daemon", "team", "update",
      "--team-id", escapeShellArg(teamId),
    ];
    if (updates.name) parts.push("--name", escapeShellArg(updates.name));
    if (updates.cwd) parts.push("--cwd", escapeShellArg(updates.cwd));
    if (updates.members) parts.push("--members", escapeShellArg(JSON.stringify(updates.members)));
    const result = await this.execDaemonCommand(target, credentials, parts.join(" "), { timeoutMs: 60000 });
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team update failed");
    return resp["team"] as unknown as TeamInfo;
  }

  async teamDelete(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
  ): Promise<void> {
    const cmd = `openvide-daemon team delete --team-id ${escapeShellArg(teamId)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team delete failed");
  }

  async teamTaskCreate(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    task: { subject: string; description: string; owner: string; dependencies?: string[] },
  ): Promise<TeamTaskInfo> {
    const parts = [
      "openvide-daemon", "team", "task", "create",
      "--team-id", escapeShellArg(teamId),
      "--subject", escapeShellArg(task.subject),
      "--description", escapeShellArg(task.description),
      "--owner", escapeShellArg(task.owner),
    ];
    if (task.dependencies?.length) {
      parts.push("--dependencies", escapeShellArg(JSON.stringify(task.dependencies)));
    }
    const result = await this.execDaemonCommand(target, credentials, parts.join(" "));
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team task create failed");
    return resp["teamTask"] as unknown as TeamTaskInfo;
  }

  async teamTaskUpdate(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    taskId: string,
    updates: { status?: string; owner?: string; description?: string },
  ): Promise<TeamTaskInfo> {
    const parts = [
      "openvide-daemon", "team", "task", "update",
      "--team-id", escapeShellArg(teamId),
      "--task-id", escapeShellArg(taskId),
    ];
    if (updates.status) parts.push("--status", escapeShellArg(updates.status));
    if (updates.owner) parts.push("--owner", escapeShellArg(updates.owner));
    if (updates.description) parts.push("--description", escapeShellArg(updates.description));
    const result = await this.execDaemonCommand(target, credentials, parts.join(" "));
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team task update failed");
    return resp["teamTask"] as unknown as TeamTaskInfo;
  }

  async teamTaskList(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
  ): Promise<TeamTaskInfo[]> {
    const cmd = `openvide-daemon team task list --team-id ${escapeShellArg(teamId)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team task list failed");
    return (resp["teamTasks"] as TeamTaskInfo[]) ?? [];
  }

  async teamTaskComment(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    taskId: string,
    author: string,
    text: string,
  ): Promise<void> {
    const cmd = `openvide-daemon team task comment --team-id ${escapeShellArg(teamId)} --task-id ${escapeShellArg(taskId)} --author ${escapeShellArg(author)} --text ${escapeShellArg(text)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team task comment failed");
  }

  async teamMessageSend(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    from: string,
    to: string,
    text: string,
  ): Promise<void> {
    const cmd = `openvide-daemon team message send --team-id ${escapeShellArg(teamId)} --from ${escapeShellArg(from)} --to ${escapeShellArg(to)} --text ${escapeShellArg(text)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team message send failed");
  }

  async teamMessageList(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    limit?: number,
  ): Promise<TeamMessageInfo[]> {
    const limitArg = limit !== undefined ? ` --limit ${String(limit)}` : "";
    const cmd = `openvide-daemon team message list --team-id ${escapeShellArg(teamId)}${limitArg}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team message list failed");
    return (resp["teamMessages"] as TeamMessageInfo[]) ?? [];
  }

  async teamPlanGenerate(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    request: string,
    opts?: TeamPlanSubmitOpts,
  ): Promise<void> {
    const parts = [
      "openvide-daemon", "team", "plan", "generate",
      "--team-id", escapeShellArg(teamId),
      "--request", escapeShellArg(request),
    ];
    if (opts?.mode) parts.push("--mode", escapeShellArg(opts.mode));
    if (opts?.reviewers?.length) parts.push("--reviewers", escapeShellArg(JSON.stringify(opts.reviewers)));
    if (opts?.maxIterations !== undefined) parts.push("--max-iterations", String(opts.maxIterations));
    const result = await this.execDaemonCommand(target, credentials, parts.join(" "), { timeoutMs: 60000 });
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team plan generate failed");
  }

  async teamPlanSubmit(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    plan: TeamPlanInput,
    opts?: TeamPlanSubmitOpts,
  ): Promise<TeamPlanInfo> {
    const parts = [
      "openvide-daemon", "team", "plan", "submit",
      "--team-id", escapeShellArg(teamId),
      "--tasks", escapeShellArg(JSON.stringify(plan.tasks)),
    ];
    if (opts?.mode) parts.push("--mode", escapeShellArg(opts.mode));
    if (opts?.reviewers?.length) parts.push("--reviewers", escapeShellArg(JSON.stringify(opts.reviewers)));
    if (opts?.maxIterations !== undefined) parts.push("--max-iterations", String(opts.maxIterations));
    const result = await this.execDaemonCommand(target, credentials, parts.join(" "));
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team plan submit failed");
    return resp["teamPlan"] as unknown as TeamPlanInfo;
  }

  async teamPlanReview(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    planId: string,
    reviewer: string,
    vote: "approve" | "revise" | "reject",
    feedback?: string,
  ): Promise<TeamPlanInfo> {
    const parts = [
      "openvide-daemon", "team", "plan", "review",
      "--team-id", escapeShellArg(teamId),
      "--plan-id", escapeShellArg(planId),
      "--reviewer", escapeShellArg(reviewer),
      "--vote", escapeShellArg(vote),
    ];
    if (feedback !== undefined) parts.push("--feedback", escapeShellArg(feedback));
    const result = await this.execDaemonCommand(target, credentials, parts.join(" "));
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team plan review failed");
    return resp["teamPlan"] as unknown as TeamPlanInfo;
  }

  async teamPlanRevise(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    planId: string,
    author: string,
    revision: TeamPlanInput,
  ): Promise<TeamPlanInfo> {
    const cmd = `openvide-daemon team plan revise --team-id ${escapeShellArg(teamId)} --plan-id ${escapeShellArg(planId)} --author ${escapeShellArg(author)} --revision ${escapeShellArg(JSON.stringify({ tasks: revision.tasks }))}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team plan revise failed");
    return resp["teamPlan"] as unknown as TeamPlanInfo;
  }

  async teamPlanGet(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    planId: string,
  ): Promise<TeamPlanInfo> {
    const cmd = `openvide-daemon team plan get --team-id ${escapeShellArg(teamId)} --plan-id ${escapeShellArg(planId)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team plan get failed");
    return resp["teamPlan"] as unknown as TeamPlanInfo;
  }

  async teamPlanLatest(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
  ): Promise<TeamPlanInfo | null> {
    const cmd = `openvide-daemon team plan latest --team-id ${escapeShellArg(teamId)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team plan latest failed");
    return (resp["teamPlan"] as TeamPlanInfo | undefined) ?? null;
  }

  async teamPlanDelete(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    planId: string,
  ): Promise<void> {
    const cmd = `openvide-daemon team plan delete --team-id ${escapeShellArg(teamId)} --plan-id ${escapeShellArg(planId)}`;
    const result = await this.execDaemonCommand(target, credentials, cmd);
    const resp = parseIpcResponse(result);
    if (!resp["ok"]) throw new Error((resp["error"] as string) ?? "Team plan delete failed");
  }

  private async execDaemonCommand(
    target: TargetProfile,
    credentials: SshCredentials,
    command: string,
    options?: DaemonExecOptions,
  ): Promise<DaemonCommandResult> {
    const timeoutMs = options?.timeoutMs ?? DaemonTransport.DEFAULT_DAEMON_TIMEOUT_MS;
    // Extract short label from command for logging (e.g. "session create", "session send")
    const cmdLabel = command.replace(/openvide-daemon\s*/, "").split(/\s+--/)[0]?.trim().slice(0, 40) ?? command.slice(0, 40);
    const t0 = Date.now();
    __DEV__ && console.log(`[OV:transport] execDaemonCommand START: "${cmdLabel}" timeout=${timeoutMs}ms target=${target.id.slice(0, 12)}`);

    // Ensure we have the daemon binary path cached before building the command.
    // This runs a short (~450 byte) resolve script first, so the actual command
    // is just '/path/to/binary <args>' (~150 bytes) — well under PTY buffer limits.
    await this.ensureDaemonBinCached(target, credentials);

    const resolvedCommand = this.withResolvedDaemonBinary(command, target.id);

    let handle: Awaited<ReturnType<typeof this.ssh.runCommand>>;
    let partialStdout = "";
    try {
      const rc0 = Date.now();
      handle = await this.ssh.runCommand(
        target,
        credentials,
        resolvedCommand,
        {
          onStdout: (chunk: string) => { partialStdout += chunk; },
          onStderr: () => {},
        },
        { mode: "scripted", conflictPolicy: options?.conflictPolicy ?? "queue" },
      );
      __DEV__ && console.log(`[OV:transport] execDaemonCommand SSH_READY: "${cmdLabel}" +${Date.now() - rc0}ms (runCommand returned handle)`);
    } catch (err) {
      __DEV__ && console.log(`[OV:transport] execDaemonCommand SSH_FAIL: "${cmdLabel}" +${Date.now() - t0}ms err=${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        handle.wait,
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error("Daemon command timed out")), timeoutMs);
        }),
      ]);
      __DEV__ && console.log(`[OV:transport] execDaemonCommand OK: "${cmdLabel}" +${Date.now() - t0}ms exit=${result.exitCode} stdout=${result.stdout.length}b`);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? null,
      };
    } catch (err) {
      __DEV__ && console.log(`[OV:transport] execDaemonCommand FAIL: "${cmdLabel}" +${Date.now() - t0}ms err=${err instanceof Error ? err.message : String(err)}`);
      // On timeout, dump the partial SSH output for diagnostics
      if (err instanceof Error && /timed out/i.test(err.message)) {
        const tail = partialStdout.slice(-2000);
        __DEV__ && console.log(`[OV:transport] execDaemonCommand TIMEOUT_DUMP: "${cmdLabel}" partialStdout=${partialStdout.length}b tail=\n${tail}`);
      }
      handle.cancel().catch(() => {});
      // On timeout, reset the SSH session so subsequent commands don't queue
      // behind a dead shell. Await the reset so the next command gets a fresh
      // connection instead of racing with the teardown.
      if (err instanceof Error && /timed out/i.test(err.message)) {
        __DEV__ && console.log(`[OV:transport] execDaemonCommand RESETTING SSH after timeout: "${cmdLabel}"`);
        this.resolvedDaemonBin.delete(target.id);
        await this.ssh.resetTargetSession(target.id).catch(() => {});
      }
      throw err;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
