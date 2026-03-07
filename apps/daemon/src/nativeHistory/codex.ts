import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { NativeSessionRecord } from "../types.js";
import { logError } from "../utils.js";
import { normalizeWorkspacePath, parseIsoOrUndefined, sortByUpdatedDesc } from "./pathUtils.js";

const MAX_PREFIX_BYTES = 256 * 1024;
const MAX_TITLE_CHARS = 220;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface CodexSessionMetaPayload {
  id?: unknown;
  cwd?: unknown;
  timestamp?: unknown;
  source?: unknown;
}

interface CodexSessionMetaLine {
  type?: unknown;
  payload?: unknown;
}

async function collectJsonlFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push(fullPath);
      }
    }
  }

  return out;
}

async function readPrefix(filePath: string, maxBytes = MAX_PREFIX_BYTES): Promise<string> {
  const file = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await file.read(buf, 0, maxBytes, 0);
    return buf.toString("utf8", 0, bytesRead);
  } finally {
    await file.close();
  }
}

function normalizeTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_TITLE_CHARS) {
    return collapsed;
  }
  return collapsed.slice(0, MAX_TITLE_CHARS - 1) + "…";
}

function isCodexBootstrapPrompt(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("<environment_context>")) return true;
  if (lower.includes("agents.md instructions for")) return true;
  if (lower.includes("<permissions instructions>")) return true;
  if (lower.includes("filesystem sandboxing defines")) return true;
  if (lower.includes("approved command prefixes")) return true;
  if (text.length > 4000 && lower.includes("## skills")) return true;
  return false;
}

function extractFirstUserPrompt(lines: string[]): string | undefined {
  let fallback: string | undefined;
  for (const line of lines) {
    let obj: JsonValue;
    try {
      obj = JSON.parse(line) as JsonValue;
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;

    const type = obj["type"];
    if (type === "response_item") {
      const payload = obj["payload"];
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      if (payload["type"] !== "message" || payload["role"] !== "user") continue;
      const content = payload["content"];
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || typeof block !== "object" || Array.isArray(block)) continue;
        const blockType = block["type"];
        const text = block["text"];
        if ((blockType === "input_text" || blockType === "text") && typeof text === "string" && text.trim().length > 0) {
          const cleaned = text.trim();
          if (!fallback) {
            fallback = normalizeTitle(cleaned);
          }
          if (!isCodexBootstrapPrompt(cleaned)) {
            return normalizeTitle(cleaned);
          }
        }
      }
      continue;
    }

    if (type === "user") {
      const message = obj["message"];
      if (!message || typeof message !== "object" || Array.isArray(message)) continue;
      const content = message["content"];
      if (typeof content === "string" && content.trim().length > 0) {
        const cleaned = content.trim();
        if (!fallback) {
          fallback = normalizeTitle(cleaned);
        }
        if (!isCodexBootstrapPrompt(cleaned)) {
          return normalizeTitle(cleaned);
        }
      }
    }
  }
  return fallback;
}

function parseSessionMeta(lines: string[]): { sessionId?: string; cwd?: string; createdAt?: string; source?: string } {
  for (const line of lines) {
    let parsed: CodexSessionMetaLine;
    try {
      parsed = JSON.parse(line) as CodexSessionMetaLine;
    } catch {
      continue;
    }
    if (parsed.type !== "session_meta" || typeof parsed.payload !== "object" || parsed.payload == null) {
      continue;
    }
    const payload = parsed.payload as CodexSessionMetaPayload;
    const sessionId = typeof payload.id === "string" ? payload.id : undefined;
    const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
    const createdAt = parseIsoOrUndefined(payload.timestamp);
    const source = typeof payload.source === "string" ? payload.source : undefined;
    return { sessionId, cwd, createdAt, source };
  }
  return {};
}

function isResumeVisibleSource(source: string | undefined): boolean {
  // `codex resume` excludes `source=exec` sessions from the picker.
  return source === "cli";
}

async function loadCodexThreadTitles(): Promise<Map<string, string>> {
  const statePath = path.join(os.homedir(), ".codex", ".codex-global-state.json");
  try {
    const raw = await fsp.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as {
      "thread-titles"?: {
        titles?: Record<string, unknown>;
      };
    };
    const titles = parsed["thread-titles"]?.titles;
    const map = new Map<string, string>();
    if (!titles || typeof titles !== "object") {
      return map;
    }
    for (const [sessionId, value] of Object.entries(titles)) {
      if (typeof value !== "string") continue;
      const normalized = normalizeTitle(value);
      if (!normalized) continue;
      map.set(sessionId, normalized);
    }
    return map;
  } catch {
    return new Map<string, string>();
  }
}

export async function listCodexNativeSessions(cwd: string): Promise<NativeSessionRecord[]> {
  const sessionsRoot = path.join(os.homedir(), ".codex", "sessions");
  const targetCwd = normalizeWorkspacePath(cwd);
  const files = await collectJsonlFiles(sessionsRoot);
  const threadTitles = await loadCodexThreadTitles();
  const dedup = new Map<string, NativeSessionRecord>();

  for (const filePath of files) {
    let prefix = "";
    try {
      prefix = await readPrefix(filePath);
    } catch {
      continue;
    }
    const lines = prefix.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    if (lines.length === 0) continue;

    const { sessionId, cwd: sessionCwd, createdAt, source } = parseSessionMeta(lines);
    if (!sessionId || !sessionCwd) continue;
    if (normalizeWorkspacePath(sessionCwd) !== targetCwd) continue;
    if (!isResumeVisibleSource(source)) continue;

    let updatedAt: string | undefined;
    try {
      const stat = await fsp.stat(filePath);
      updatedAt = stat.mtime.toISOString();
    } catch {
      // no-op
    }

    const title = threadTitles.get(sessionId) ?? extractFirstUserPrompt(lines);
    const candidate: NativeSessionRecord = {
      id: `codex:${sessionId}`,
      tool: "codex",
      nativeSessionId: sessionId,
      workingDirectory: sessionCwd,
      createdAt,
      updatedAt,
      title,
      source: "native",
    };

    const existing = dedup.get(candidate.id);
    if (!existing) {
      dedup.set(candidate.id, candidate);
      continue;
    }
    const existingTs = existing.updatedAt ?? existing.createdAt ?? "";
    const nextTs = candidate.updatedAt ?? candidate.createdAt ?? "";
    if (nextTs.localeCompare(existingTs) > 0) {
      dedup.set(candidate.id, candidate);
    }
  }

  return sortByUpdatedDesc([...dedup.values()]);
}

export async function listCodexLegacySessions(): Promise<NativeSessionRecord[]> {
  // Older Codex session files may not include cwd, so we intentionally exclude them
  // from workspace-filtered history for correctness.
  return [];
}
