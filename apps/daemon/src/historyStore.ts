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

const MAX_JSONL_BYTES = 16 * 1024 * 1024; // 16 MB — anything larger gets tailed

async function readJsonlLines(filePath: string): Promise<string[]> {
  let content: string;
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_JSONL_BYTES) {
      // Tail the last 16 MB so huge Codex session files don't blow memory
      // or hang the daemon's response to the webview.
      const fd = await fs.open(filePath, "r");
      try {
        const start = stat.size - MAX_JSONL_BYTES;
        const buf = Buffer.alloc(MAX_JSONL_BYTES);
        await fd.read(buf, 0, MAX_JSONL_BYTES, start);
        // Drop the first (likely partial) line.
        content = buf.toString("utf8");
        const nl = content.indexOf("\n");
        if (nl >= 0) content = content.slice(nl + 1);
      } finally {
        await fd.close();
      }
    } else {
      content = await fs.readFile(filePath, "utf8");
    }
  } catch {
    return [];
  }
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function findClaudeSessionFile(sessionId: string, cwd?: string): Promise<string | undefined> {
  const root = path.join(os.homedir(), ".claude", "projects");
  const targetCwd = cwd ? normalizeWorkspacePath(cwd) : undefined;
  const wanted = `${sessionId}.jsonl`;
  const queue: string[] = [root];

  // Track the best match: prefer the most recently modified file.
  // A continuation file (different filename but embedded sessionId matches)
  // is newer and should take precedence over the original.
  let bestMatch: string | undefined;
  let bestMtime = 0;

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

      const isExactMatch = entry.name === wanted;

      // For non-exact matches, do a quick prefix check for the sessionId
      // to find continuation files that reference this session.
      if (!isExactMatch) {
        try {
          const fd = await fs.open(fullPath, "r");
          try {
            const buf = Buffer.alloc(4096);
            const { bytesRead } = await fd.read(buf, 0, 4096, 0);
            const prefix = buf.toString("utf8", 0, bytesRead);
            if (!prefix.includes(sessionId)) continue;
          } finally {
            await fd.close();
          }
        } catch {
          continue;
        }
      }

      // Verify CWD match if required
      if (targetCwd) {
        let cwdMatched = false;
        try {
          const lines = await readJsonlLines(fullPath);
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>;
              const sessionCwd = typeof parsed.cwd === "string" ? normalizeWorkspacePath(parsed.cwd) : undefined;
              if (sessionCwd === targetCwd) {
                cwdMatched = true;
                break;
              }
            } catch {
              // ignore malformed line
            }
          }
        } catch {
          continue;
        }
        if (!cwdMatched) continue;
      }

      // Track the most recently modified matching file
      try {
        const stat = await fs.stat(fullPath);
        const mtime = stat.mtimeMs;
        if (mtime > bestMtime) {
          bestMtime = mtime;
          bestMatch = fullPath;
        }
      } catch {
        // If we can't stat but it's an exact match, use it as fallback
        if (isExactMatch && !bestMatch) {
          bestMatch = fullPath;
        }
      }
    }
  }

  return bestMatch;
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

export async function findCodexSessionFile(sessionId: string, cwd?: string): Promise<string | undefined> {
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
