import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { buildCommand } from "./commandBuilder.js";
import { appendOutput } from "./outputStore.js";
import { resolveClaudeAuth } from "./authCache.js";
import { nowEpoch, log, logError } from "./utils.js";
import type { SessionRecord, Tool, OutputLine } from "./types.js";

export interface RunResult {
  exitCode: number | null;
  conversationId?: string;
  resumeUnsupported?: boolean;
  fallbackToCli?: boolean;
}

export interface RunningProcess {
  child?: child_process.ChildProcess;
  pid?: number;
  kill: (signal?: NodeJS.Signals) => void;
}

/**
 * Build an env object with common tool directories prepended to PATH.
 * The daemon's inherited PATH may be minimal (e.g. from a bare SSH session),
 * so we ensure popular install locations are reachable.
 */
function augmentedEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const extraDirs = [
    `${home}/.local/bin`,
    `${home}/.npm-global/bin`,
    `${home}/.cargo/bin`,
    `${home}/.bun/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const currentPath = process.env.PATH ?? "/usr/bin:/bin";
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: [...extraDirs, currentPath].join(":"),
    ...extraEnv,
  };
  // Remove env vars that cause Claude Code to think this is a nested session.
  const blockedVars = new Set(["CLAUDECODE", "CLAUDE_CODE"]);
  for (const key of Object.keys(env)) {
    if (blockedVars.has(key.toUpperCase())) {
      delete env[key];
    }
  }
  return env as NodeJS.ProcessEnv;
}

function shouldInjectClaudeApiKey(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return false;

  const isMac = process.platform === "darwin";
  if (!isMac) return true;

  const isSshSession = Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY);
  if (isSshSession) return true;

  return process.env.OPENVIDE_FORCE_CLAUDE_API_KEY === "1";
}

/**
 * Spawn a CLI process for a session turn.
 * Captures stdout/stderr line-by-line to output.jsonl.
 * Monitors output for conversation ID extraction.
 * Calls `onFinished` when the process exits.
 */
export function spawnTurn(
  session: SessionRecord,
  prompt: string,
  turnOpts: { mode?: string; model?: string },
  onOutputDelta: (lines: number, bytes: number) => void,
  onFinished: (result: RunResult) => void,
): RunningProcess {
  const buildTurnCommand = (conversationId?: string): string => buildCommand(session.tool, {
    prompt,
    conversationId,
    model: turnOpts.model ?? session.model,
    mode: turnOpts.mode,
    autoAccept: session.autoAccept,
  });
  const command = buildTurnCommand(session.conversationId);

  log(`Spawning [${session.tool}] for session ${session.id}: ${command.slice(0, 120)}...`);

  let child: child_process.ChildProcess | null = null;
  let conversationId: string | undefined;
  let resumeUnsupported = false;
  let shouldKill = false;

  // Write turn_start marker
  const startEntry: OutputLine = {
    t: "m",
    ts: nowEpoch(),
    event: "turn_start",
    prompt,
  };
  const startDelta = appendOutput(session.id, startEntry);
  onOutputDelta(startDelta.lines, startDelta.bytes);

  const maybeRetryWithoutResume = (
    usedConversationId: string | undefined,
    code: number | null,
    stderrLines: string[],
  ): boolean => {
    if (session.tool !== "codex" || !usedConversationId) return false;
    if (code == null || code === 0) return false;

    const stderrText = stderrLines.join("\n");
    return /unexpected argument/i.test(stderrText) && /usage:\s*codex exec/i.test(stderrText);
  };

  // Resolve auth for Claude sessions: try macOS Keychain, fall back to cache.
  // On macOS, SSH sessions with key-based auth don't unlock the login Keychain,
  // so daemon-spawned Claude can't find its OAuth token. We read it ourselves
  // and pass it as ANTHROPIC_API_KEY.
  const authEnv: Record<string, string> = {};
  if (session.tool === "claude" && shouldInjectClaudeApiKey()) {
    const token = resolveClaudeAuth();
    if (token) {
      authEnv.ANTHROPIC_API_KEY = token;
    }
  }

  const spawnCommand = (cmd: string, usedConversationId: string | undefined): void => {
    // Expand ~ to home directory — Node spawn doesn't do shell expansion
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const resolvedCwd = session.workingDirectory.startsWith("~")
      ? session.workingDirectory.replace("~", home)
      : session.workingDirectory;

    child = child_process.spawn("sh", ["-c", cmd], {
      cwd: resolvedCwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: augmentedEnv(authEnv),
    });
    child.stdin?.end();

    if (shouldKill && !child.killed) {
      child.kill("SIGINT");
    }

    const stderrLines: string[] = [];
    const stdoutBuffer: string[] = [];
    let stdoutRl: readline.Interface | undefined;
    let stderrRl: readline.Interface | undefined;

    const closeReadlines = () => {
      if (stdoutRl) { stdoutRl.close(); stdoutRl = undefined; }
      if (stderrRl) { stderrRl.close(); stderrRl = undefined; }
    };

    if (child.stdout) {
      stdoutRl = readline.createInterface({ input: child.stdout });
      stdoutRl.on("line", (line) => {
        // For Gemini, the whole CLI output is ONE pretty-printed JSON blob split
        // across many stdout lines (none individually parseable). We buffer the
        // lines here and emit a synthesized text event at close time so the
        // webview parser can render the response normally.
        if (session.tool === "gemini") {
          stdoutBuffer.push(line);
          return;
        }
        const entry: OutputLine = { t: "o", ts: nowEpoch(), line };
        const delta = appendOutput(session.id, entry);
        onOutputDelta(delta.lines, delta.bytes);

        const extracted = extractConversationId(session.tool, line);
        if (extracted) {
          conversationId = extracted;
        }
      });
    }

    if (child.stderr) {
      stderrRl = readline.createInterface({ input: child.stderr });
      stderrRl.on("line", (line) => {
        stderrLines.push(line);
        // Gemini prints noisy startup banners + node deprecation warnings on
        // stderr that aren't real errors. Keep them for retry detection but
        // don't persist as chat output.
        if (session.tool === "gemini") return;
        const entry: OutputLine = { t: "e", ts: nowEpoch(), line };
        const delta = appendOutput(session.id, entry);
        onOutputDelta(delta.lines, delta.bytes);
      });
    }

    child.on("error", (err) => {
      closeReadlines();
      logError(`Process error for session ${session.id}:`, err.message);
      const entry: OutputLine = {
        t: "m",
        ts: nowEpoch(),
        event: "error",
        error: err.message,
      };
      const delta = appendOutput(session.id, entry);
      onOutputDelta(delta.lines, delta.bytes);
      onFinished({ exitCode: 1, conversationId, resumeUnsupported });
    });

    child.on("close", (code) => {
      closeReadlines();
      if (maybeRetryWithoutResume(usedConversationId, code, stderrLines) && !shouldKill) {
        resumeUnsupported = true;
        conversationId = undefined;
        log("Codex resume invocation failed; retrying turn without resume");
        const retryEntry: OutputLine = {
          t: "e",
          ts: nowEpoch(),
          line: "[openvide-daemon] Codex resume unsupported by this CLI build; retrying without resume.",
        };
        const retryDelta = appendOutput(session.id, retryEntry);
        onOutputDelta(retryDelta.lines, retryDelta.bytes);
        const fallback = buildTurnCommand(undefined);
        spawnCommand(fallback, undefined);
        return;
      }

      // Gemini: emit the parsed response as a synthesized text event + capture
      // the returned session_id as the conversation id for resume.
      if (session.tool === "gemini" && stdoutBuffer.length > 0) {
        const raw = stdoutBuffer.join("\n").trim();
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed?.session_id === "string" && parsed.session_id) {
            conversationId = parsed.session_id;
          }
          const text = typeof parsed?.response === "string" && parsed.response.length > 0
            ? parsed.response
            : typeof parsed?.text === "string" ? parsed.text : "";
          if (text) {
            const synth: OutputLine = {
              t: "o",
              ts: nowEpoch(),
              line: JSON.stringify({ type: "text", text }),
            };
            const sDelta = appendOutput(session.id, synth);
            onOutputDelta(sDelta.lines, sDelta.bytes);
          }
        } catch {
          // Fall back: emit raw buffer as-is so it's at least visible
          const fallback: OutputLine = { t: "o", ts: nowEpoch(), line: raw };
          const fDelta = appendOutput(session.id, fallback);
          onOutputDelta(fDelta.lines, fDelta.bytes);
        }
      }

      const endEntry: OutputLine = {
        t: "m",
        ts: nowEpoch(),
        event: "turn_end",
        exitCode: code ?? 1,
      };
      const delta = appendOutput(session.id, endEntry);
      onOutputDelta(delta.lines, delta.bytes);

      log(`Process exited for session ${session.id} with code ${code}`);
      onFinished({ exitCode: code, conversationId, resumeUnsupported });
    });
  };

  spawnCommand(command, session.conversationId);

  return {
    get child() {
      return child as child_process.ChildProcess;
    },
    get pid() {
      return child?.pid;
    },
    kill: (signal: NodeJS.Signals = "SIGINT") => {
      shouldKill = true;
      if (child && !child.killed) {
        child.kill(signal);
      }
    },
  };
}

function extractConversationId(tool: Tool, line: string): string | undefined {
  try {
    const obj = JSON.parse(line);
    if (tool === "claude" && obj.type === "result" && typeof obj.session_id === "string") {
      return obj.session_id;
    }
    if (tool === "codex" && obj.type === "thread.started" && typeof obj.thread_id === "string") {
      return obj.thread_id;
    }
  } catch {
    // Not JSON — ignore
  }
  return undefined;
}

/**
 * Codex `exec` sessions are stored with source=exec, which hides them from the
 * interactive `codex resume` picker (it only lists source=cli). Patch the session
 * file's first line so the session appears in the picker alongside native sessions.
 */
export function patchCodexSessionSource(threadId: string): void {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const sessionsDir = path.join(home, ".codex", "sessions");

  try {
    // Find the session file by scanning recent date dirs for a filename containing the threadId
    const sessionFile = findCodexSessionFile(sessionsDir, threadId);
    if (!sessionFile) {
      log(`[codex-patch] No session file found for thread ${threadId}`);
      return;
    }

    const content = fs.readFileSync(sessionFile, "utf8");
    const newlineIdx = content.indexOf("\n");
    if (newlineIdx === -1) return;

    const firstLine = content.slice(0, newlineIdx);
    try {
      const meta = JSON.parse(firstLine);
      if (meta?.payload?.source === "exec") {
        meta.payload.source = "cli";
        meta.payload.originator = "codex_cli_rs";
        const patched = JSON.stringify(meta) + content.slice(newlineIdx);
        fs.writeFileSync(sessionFile, patched, "utf8");
        log(`[codex-patch] Patched session ${threadId} source to cli`);
      }
    } catch {
      // Malformed first line — skip
    }
  } catch (err) {
    log(`[codex-patch] Failed to patch session ${threadId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function findCodexSessionFile(sessionsDir: string, threadId: string): string | undefined {
  // Session files are stored in YYYY/MM/DD subdirs with threadId in filename
  try {
    const years = fs.readdirSync(sessionsDir).filter((d) => /^\d{4}$/.test(d)).sort().reverse();
    for (const year of years) {
      const yearPath = path.join(sessionsDir, year);
      const months = safeReaddir(yearPath).sort().reverse();
      for (const month of months) {
        const monthPath = path.join(yearPath, month);
        const days = safeReaddir(monthPath).sort().reverse();
        for (const day of days) {
          const dayPath = path.join(monthPath, day);
          const files = safeReaddir(dayPath);
          const match = files.find((f) => f.includes(threadId) && f.endsWith(".jsonl"));
          if (match) return path.join(dayPath, match);
        }
      }
    }
  } catch {
    // sessionsDir doesn't exist
  }
  return undefined;
}

function safeReaddir(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
}
