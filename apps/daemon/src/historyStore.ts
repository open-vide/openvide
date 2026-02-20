import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readOutputLines } from "./outputStore.js";
import { normalizeWorkspacePath } from "./nativeHistory/pathUtils.js";
import type { SessionHistoryPayload, SessionRecord } from "./types.js";

const DEFAULT_LIMIT_LINES = 8000;
const CODEX_PREFIX_BYTES = 256 * 1024;

function normalizeLimit(input?: number): number {
  if (!input || !Number.isFinite(input) || input <= 0) {
    return DEFAULT_LIMIT_LINES;
  }
  return Math.max(1, Math.floor(input));
}

function applyTailLimit(lines: string[], limitLines: number): { lines: string[]; truncated: boolean } {
  if (lines.length <= limitLines) {
    return { lines, truncated: false };
  }
  return {
    lines: lines.slice(-limitLines),
    truncated: true,
  };
}

async function readJsonlLines(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function findClaudeSessionFile(sessionId: string, cwd?: string): Promise<string | undefined> {
  const root = path.join(os.homedir(), ".claude", "projects");
  const targetCwd = cwd ? normalizeWorkspacePath(cwd) : undefined;
  const wanted = `${sessionId}.jsonl`;
  const queue: string[] = [root];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== wanted) continue;
      if (!targetCwd) return fullPath;

      try {
        const lines = await readJsonlLines(fullPath);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const sessionCwd = typeof parsed.cwd === "string" ? normalizeWorkspacePath(parsed.cwd) : undefined;
            if (sessionCwd === targetCwd) {
              return fullPath;
            }
          } catch {
            // ignore malformed line
          }
        }
      } catch {
        // ignore malformed file
      }
    }
  }

  return undefined;
}

async function readPrefix(filePath: string, maxBytes: number): Promise<string> {
  const file = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await file.read(buf, 0, maxBytes, 0);
    return buf.toString("utf8", 0, bytesRead);
  } finally {
    await file.close();
  }
}

async function findCodexSessionFile(sessionId: string, cwd?: string): Promise<string | undefined> {
  const root = path.join(os.homedir(), ".codex", "sessions");
  const targetCwd = cwd ? normalizeWorkspacePath(cwd) : undefined;
  const queue: string[] = [root];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

      let prefix = "";
      try {
        prefix = await readPrefix(fullPath, CODEX_PREFIX_BYTES);
      } catch {
        continue;
      }
      if (!prefix.includes(sessionId) || !prefix.includes("\"session_meta\"")) {
        continue;
      }

      const lines = prefix.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.type !== "session_meta") continue;
          const payload = parsed.payload as Record<string, unknown> | undefined;
          if (!payload) continue;
          if (payload.id !== sessionId) continue;
          if (!targetCwd) return fullPath;
          const sessionCwd = typeof payload.cwd === "string" ? normalizeWorkspacePath(payload.cwd) : undefined;
          if (sessionCwd === targetCwd) {
            return fullPath;
          }
        } catch {
          // ignore malformed line
        }
      }
    }
  }

  return undefined;
}

export function readHistoryForDaemonSession(
  session: SessionRecord,
  limitLines?: number,
): SessionHistoryPayload {
  const allLines = readOutputLines(session.id, 0);
  const lineCount = allLines.length;
  const limited = applyTailLimit(allLines, normalizeLimit(limitLines));
  return {
    source: "daemon",
    tool: session.tool,
    format: "daemon_output_jsonl",
    lines: limited.lines,
    lineCount,
    truncated: limited.truncated,
  };
}

export async function readHistoryForNativeSession(input: {
  tool: "claude" | "codex";
  resumeId: string;
  cwd?: string;
  limitLines?: number;
}): Promise<SessionHistoryPayload> {
  const filePath = input.tool === "claude"
    ? await findClaudeSessionFile(input.resumeId, input.cwd)
    : await findCodexSessionFile(input.resumeId, input.cwd);

  if (!filePath) {
    throw new Error(`Native ${input.tool} session ${input.resumeId} not found`);
  }

  const allLines = await readJsonlLines(filePath);
  const lineCount = allLines.length;
  const limited = applyTailLimit(allLines, normalizeLimit(input.limitLines));
  return {
    source: "native",
    tool: input.tool,
    format: input.tool === "claude" ? "native_claude_jsonl" : "native_codex_jsonl",
    lines: limited.lines,
    lineCount,
    truncated: limited.truncated,
  };
}
