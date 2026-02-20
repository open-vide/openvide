import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { NativeSessionRecord } from "../types.js";
import { logError } from "../utils.js";
import { normalizeWorkspacePath, parseIsoOrUndefined, sortByUpdatedDesc } from "./pathUtils.js";

const MAX_PREFIX_BYTES = 128 * 1024;

interface ClaudeSessionsIndexEntry {
  sessionId?: unknown;
  projectPath?: unknown;
  created?: unknown;
  modified?: unknown;
  fileMtime?: unknown;
  firstPrompt?: unknown;
  summary?: unknown;
  messageCount?: unknown;
}

interface ClaudeSessionsIndexFile {
  entries?: unknown;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function fromEpochMillis(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function cleanLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "no prompt") return undefined;
  return trimmed;
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

function extractJsonString(raw: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`"${escapedKey}":"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`));
  if (!match || !match[1]) return undefined;
  return match[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

function parseClaudeJsonlMeta(raw: string, lines: string[]): {
  sessionId?: string;
  cwd?: string;
  createdAt?: string;
  title?: string;
} {
  let sessionId: string | undefined = extractJsonString(raw, "sessionId");
  let cwd: string | undefined = extractJsonString(raw, "cwd");
  let createdAt: string | undefined = parseIsoOrUndefined(extractJsonString(raw, "timestamp"));
  let title: string | undefined;

  for (const line of lines) {
    let obj: JsonValue;
    try {
      obj = JSON.parse(line) as JsonValue;
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;

    if (!sessionId && typeof obj["sessionId"] === "string") {
      sessionId = obj["sessionId"];
    }
    if (!cwd && typeof obj["cwd"] === "string") {
      cwd = obj["cwd"];
    }
    if (!createdAt && typeof obj["timestamp"] === "string") {
      createdAt = parseIsoOrUndefined(obj["timestamp"]);
    }

    if (!title && obj["type"] === "user") {
      const message = obj["message"];
      if (message && typeof message === "object" && !Array.isArray(message)) {
        const messageContent = message["content"];
        if (typeof messageContent === "string" && messageContent.trim().length > 0) {
          title = messageContent.trim();
        } else if (Array.isArray(messageContent)) {
          for (const block of messageContent) {
            if (!block || typeof block !== "object" || Array.isArray(block)) continue;
            const text = block["text"];
            if (typeof text === "string" && text.trim().length > 0) {
              title = text.trim();
              break;
            }
          }
        }
      }
    }
  }

  return { sessionId, cwd, createdAt, title };
}

export async function listClaudeNativeSessions(cwd: string): Promise<NativeSessionRecord[]> {
  const targetCwd = normalizeWorkspacePath(cwd);
  const projectsRoot = path.join(os.homedir(), ".claude", "projects");
  const dedup = new Map<string, NativeSessionRecord>();

  let projectDirs: fs.Dirent[] = [];
  try {
    projectDirs = await fsp.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;
    const indexPath = path.join(projectsRoot, projectDir.name, "sessions-index.json");

    let raw = "";
    try {
      raw = await fsp.readFile(indexPath, "utf8");
    } catch {
      // index file is optional; fallback JSONL parsing below.
    }

    if (raw.trim().length > 0) {
      let parsed: ClaudeSessionsIndexFile;
      try {
        parsed = JSON.parse(raw) as ClaudeSessionsIndexFile;
      } catch (err) {
        logError("Failed to parse Claude sessions index:", indexPath, err);
        parsed = {};
      }

      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      for (const entryRaw of entries) {
        const entry = entryRaw as ClaudeSessionsIndexEntry;
        const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : undefined;
        const projectPath = typeof entry.projectPath === "string" ? entry.projectPath : undefined;
        if (!sessionId || !projectPath) continue;
        if (normalizeWorkspacePath(projectPath) !== targetCwd) continue;

        const createdAt =
          parseIsoOrUndefined(entry.created) ??
          parseIsoOrUndefined(entry.modified) ??
          fromEpochMillis(entry.fileMtime);
        const updatedAt =
          parseIsoOrUndefined(entry.modified) ??
          parseIsoOrUndefined(entry.created) ??
          fromEpochMillis(entry.fileMtime);
        const messageCount = typeof entry.messageCount === "number" ? entry.messageCount : undefined;
        dedup.set(`claude:${sessionId}`, {
          id: `claude:${sessionId}`,
          tool: "claude",
          nativeSessionId: sessionId,
          workingDirectory: projectPath,
          createdAt,
          updatedAt,
          title: cleanLabel(entry.firstPrompt),
          summary: cleanLabel(entry.summary),
          messageCount,
          source: "native",
        });
      }
    }

    let files: fs.Dirent[] = [];
    try {
      files = await fsp.readdir(path.join(projectsRoot, projectDir.name), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const fullPath = path.join(projectsRoot, projectDir.name, file.name);
      let prefix = "";
      try {
        prefix = await readPrefix(fullPath);
      } catch {
        continue;
      }
      const lines = prefix.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
      if (lines.length === 0) continue;

      const meta = parseClaudeJsonlMeta(prefix, lines);
      if (!meta.sessionId || !meta.cwd) continue;
      if (normalizeWorkspacePath(meta.cwd) !== targetCwd) continue;

      let updatedAt: string | undefined;
      try {
        updatedAt = (await fsp.stat(fullPath)).mtime.toISOString();
      } catch {
        // no-op
      }

      const key = `claude:${meta.sessionId}`;
      const existing = dedup.get(key);
      const candidate: NativeSessionRecord = {
        id: key,
        tool: "claude",
        nativeSessionId: meta.sessionId,
        workingDirectory: meta.cwd,
        createdAt: meta.createdAt,
        updatedAt,
        title: cleanLabel(meta.title),
        source: "native",
      };

      if (!existing) {
        dedup.set(key, candidate);
        continue;
      }

      const existingTs = existing.updatedAt ?? existing.createdAt ?? "";
      const candidateTs = candidate.updatedAt ?? candidate.createdAt ?? "";
      if (candidateTs.localeCompare(existingTs) > 0) {
        dedup.set(key, {
          ...candidate,
          summary: existing.summary,
          messageCount: existing.messageCount,
        });
      } else if (!existing.title && candidate.title) {
        existing.title = candidate.title;
      }
    }
  }

  return sortByUpdatedDesc([...dedup.values()]);
}
