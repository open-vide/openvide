import * as child_process from "node:child_process";
import * as readline from "node:readline";
import { buildCommand } from "./commandBuilder.js";
import { appendOutput } from "./outputStore.js";
import { nowEpoch, log, logError } from "./utils.js";
import type { SessionRecord, Tool, OutputLine } from "./types.js";

export interface RunResult {
  exitCode: number | null;
  conversationId?: string;
}

export interface RunningProcess {
  child: child_process.ChildProcess;
  kill: (signal?: NodeJS.Signals) => void;
}

/**
 * Build an env object with common tool directories prepended to PATH.
 * The daemon's inherited PATH may be minimal (e.g. from a bare SSH session),
 * so we ensure popular install locations are reachable.
 */
function augmentedEnv(): NodeJS.ProcessEnv {
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
  const env = {
    ...process.env,
    PATH: [...extraDirs, currentPath].join(":"),
  };
  // Remove env vars that cause Claude Code to think this is a nested session.
  const blockedVars = new Set(["CLAUDECODE", "CLAUDE_CODE"]);
  for (const key of Object.keys(env)) {
    if (blockedVars.has(key.toUpperCase())) {
      delete (env as Record<string, string | undefined>)[key];
    }
  }
  return env;
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
  onOutputDelta: (lines: number, bytes: number) => void,
  onFinished: (result: RunResult) => void,
): RunningProcess {
  const command = buildCommand(session.tool, {
    prompt,
    conversationId: session.conversationId,
    model: session.model,
    autoAccept: session.autoAccept,
  });

  log(`Spawning [${session.tool}] for session ${session.id}: ${command.slice(0, 120)}...`);

  const child = child_process.spawn("sh", ["-c", command], {
    cwd: session.workingDirectory,
    stdio: ["pipe", "pipe", "pipe"],
    env: augmentedEnv(),
  });

  // Close stdin immediately — daemon is non-interactive, no CLI should wait for input
  child.stdin?.end();

  let conversationId: string | undefined;

  // Write turn_start marker
  const startEntry: OutputLine = {
    t: "m",
    ts: nowEpoch(),
    event: "turn_start",
    prompt,
  };
  const startDelta = appendOutput(session.id, startEntry);
  onOutputDelta(startDelta.lines, startDelta.bytes);

  // stdout — line-by-line
  if (child.stdout) {
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const entry: OutputLine = { t: "o", ts: nowEpoch(), line };
      const delta = appendOutput(session.id, entry);
      onOutputDelta(delta.lines, delta.bytes);

      // Extract conversation ID
      const extracted = extractConversationId(session.tool, line);
      if (extracted) {
        conversationId = extracted;
      }
    });
  }

  // stderr — line-by-line
  if (child.stderr) {
    const rl = readline.createInterface({ input: child.stderr });
    rl.on("line", (line) => {
      const entry: OutputLine = { t: "e", ts: nowEpoch(), line };
      const delta = appendOutput(session.id, entry);
      onOutputDelta(delta.lines, delta.bytes);
    });
  }

  child.on("error", (err) => {
    logError(`Process error for session ${session.id}:`, err.message);
    const entry: OutputLine = {
      t: "m",
      ts: nowEpoch(),
      event: "error",
      error: err.message,
    };
    const delta = appendOutput(session.id, entry);
    onOutputDelta(delta.lines, delta.bytes);
    onFinished({ exitCode: 1, conversationId });
  });

  child.on("close", (code) => {
    const endEntry: OutputLine = {
      t: "m",
      ts: nowEpoch(),
      event: "turn_end",
      exitCode: code ?? 1,
    };
    const delta = appendOutput(session.id, endEntry);
    onOutputDelta(delta.lines, delta.bytes);

    log(`Process exited for session ${session.id} with code ${code}`);
    onFinished({ exitCode: code, conversationId });
  });

  return {
    child,
    kill: (signal: NodeJS.Signals = "SIGINT") => {
      if (!child.killed) {
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
