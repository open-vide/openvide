/**
 * Live-tail external Claude / Codex native session files.
 *
 * The daemon already knows how to read a native JSONL file once
 * (`readHistoryForNativeSession`) and already knows how to stream its own
 * daemon-spawned session output (`outputStore.ts` + bridge `subscribe`).
 *
 * This module fills the gap in the middle: a session that is being driven by
 * an external `claude` / `codex` process in a separate terminal, where we
 * need to push new JSONL lines to the webview as they are appended.
 *
 * Subscribers get two kinds of events:
 *   - On first subscribe, the full current file content is replayed (so the
 *     webview has the same state as a one-shot `session.history` fetch).
 *   - Every newly appended line is pushed as it's detected (`fs.watch` with a
 *     polling fallback, same pattern as `outputStore.ts`).
 *
 * Each emitted event is wrapped in the daemon's standard output-line
 * envelope `{"t":"o","line":<raw native jsonl>}` so the existing webview
 * stream parser (`parseOutputLine` in apps/g2/src/domain/output-parser.ts)
 * handles them alongside daemon-sourced output.
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { findClaudeSessionFile, findCodexSessionFile } from "./historyStore.js";
import { log, logError } from "./utils.js";

export type NativeTool = "claude" | "codex" | "gemini";

export interface NativeLiveSubscription {
  tool: NativeTool;
  resumeId: string;
  cwd?: string;
}

/**
 * Gemini CLI persists chat sessions as individual JSON files at
 *   ~/.gemini/tmp/<project-hash>/chats/session-<timestamp>-<shortid>.json
 * (whereas Claude and Codex use append-only JSONL).
 *
 * We locate the file by matching the short id at the end of the filename
 * against the resumeId. The resumeId can be the short id (e.g. "3892dabc") or
 * a full session UUID — we try prefix/exact matches against the filename.
 */
async function findGeminiSessionFile(resumeId: string): Promise<string | undefined> {
  const root = path.join(os.homedir(), ".gemini", "tmp");
  const needle = resumeId.split("-")[0] ?? resumeId;
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const projectDir of entries) {
    if (!projectDir.isDirectory()) continue;
    const chatsDir = path.join(root, projectDir.name, "chats");
    let chatFiles: fs.Dirent[] = [];
    try {
      chatFiles = await fsp.readdir(chatsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of chatFiles) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      if (file.name.includes(needle) || file.name.includes(resumeId)) {
        return path.join(chatsDir, file.name);
      }
    }
  }
  return undefined;
}

type Listener = (line: string) => void;

interface Watch {
  key: string;
  listeners: Set<Listener>;
  dispose: () => void;
}

// File watches are shared across subscribers — every WebSocket client that
// subscribes to the same native id reuses the single fs.watch handle.
const watches = new Map<string, Watch>();
const POLL_INTERVAL_MS = 500;

function keyFor(input: NativeLiveSubscription): string {
  return `${input.tool}|${input.resumeId}|${input.cwd ?? ""}`;
}

function wrapOutput(nativeLine: string): string {
  // Match the daemon's `OutputLineStdout` shape. We intentionally OMIT the
  // `ts` field so identical underlying lines produce identical envelopes —
  // the webview's `seenLines` dedup then filters re-emissions across the
  // initial replay / fs.watch / polling races.
  return JSON.stringify({ t: "o", line: nativeLine });
}

async function resolveFile(input: NativeLiveSubscription): Promise<string | undefined> {
  if (input.tool === "claude") return findClaudeSessionFile(input.resumeId, input.cwd);
  if (input.tool === "codex") return findCodexSessionFile(input.resumeId, input.cwd);
  return findGeminiSessionFile(input.resumeId);
}

/**
 * Gemini persists its chat as a single JSON blob. We convert the blob into
 * line-oriented events the webview's output parser understands:
 *   - each user message becomes a "prompt" marker
 *   - each assistant message becomes a "text" CLI-like event
 * The exact schema of the Gemini chat file: an object with a `history` array
 * of `{role: "user"|"model", parts: [{text: "..."}]}` entries.
 */
function geminiBlobToLines(blob: string): string[] {
  try {
    const parsed = JSON.parse(blob) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const history = (parsed as { history?: unknown }).history;
    if (!Array.isArray(history)) return [];
    const out: string[] = [];
    for (const entry of history) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as { role?: unknown; parts?: unknown };
      const role = typeof e.role === "string" ? e.role : "";
      const parts = Array.isArray(e.parts) ? e.parts : [];
      let text = "";
      for (const part of parts) {
        if (part && typeof part === "object") {
          const t = (part as { text?: unknown }).text;
          if (typeof t === "string") text += t;
        }
      }
      const trimmed = text.trim();
      if (!trimmed) continue;
      if (role === "user") {
        out.push(JSON.stringify({ type: "user", message: { role: "user", content: trimmed } }));
      } else {
        out.push(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: trimmed }] } }));
      }
    }
    return out;
  } catch {
    return [];
  }
}

function splitJsonlChunk(chunk: string): string[] {
  return chunk
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function startWatch(input: NativeLiveSubscription, key: string): Watch {
  const listeners = new Set<Listener>();
  let filePath: string | undefined;
  let byteOffset = 0;
  let fsWatcher: fs.FSWatcher | undefined;
  let poller: NodeJS.Timeout | undefined;
  let reading = false;
  let disposed = false;
  // Remainder of the last read chunk that didn't end with a newline — the
  // writer is still appending so the final line may be incomplete.
  let carry = "";

  const emit = (line: string) => {
    const event = wrapOutput(line);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        logError(`[native-live] listener threw for ${key}:`, err);
      }
    }
  };

  const drain = async () => {
    if (disposed || reading) return;
    reading = true;
    try {
      if (!filePath) {
        filePath = await resolveFile(input);
        if (!filePath) return;
        try {
          fsWatcher = fs.watch(filePath, { persistent: false }, () => void drain());
        } catch {
          // fs.watch unavailable on this FS — polling will carry us.
        }
      }
      const stat = await fsp.stat(filePath).catch(() => undefined);
      if (!stat) return;
      if (stat.size === byteOffset && input.tool !== "gemini") return;
      if (stat.size < byteOffset) {
        // File was truncated / rotated. Reset and re-read.
        byteOffset = 0;
        carry = "";
      }
      if (input.tool === "gemini") {
        // Gemini rewrites the whole chat JSON each turn — re-read the entire
        // file and emit every message. The webview's `seenLines` dedup filters
        // re-emissions so repeats are free.
        const content = await fsp.readFile(filePath, "utf8").catch(() => "");
        byteOffset = stat.size;
        for (const synthetic of geminiBlobToLines(content)) emit(synthetic);
        return;
      }
      const fd = await fsp.open(filePath, "r");
      try {
        const length = stat.size - byteOffset;
        const buf = Buffer.alloc(length);
        await fd.read(buf, 0, length, byteOffset);
        byteOffset = stat.size;
        const chunk = carry + buf.toString("utf8");
        const newlineIdx = chunk.lastIndexOf("\n");
        let complete: string;
        if (newlineIdx < 0) {
          // No newline yet — entire chunk is carry-over.
          carry = chunk;
          complete = "";
        } else {
          complete = chunk.slice(0, newlineIdx);
          carry = chunk.slice(newlineIdx + 1);
        }
        for (const line of splitJsonlChunk(complete)) emit(line);
      } finally {
        await fd.close();
      }
    } catch (err) {
      logError(`[native-live] read failed for ${key}:`, err);
    } finally {
      reading = false;
    }
  };

  void drain();
  poller = setInterval(() => void drain(), POLL_INTERVAL_MS);

  const dispose = () => {
    disposed = true;
    if (fsWatcher) {
      try { fsWatcher.close(); } catch { /* ignore */ }
      fsWatcher = undefined;
    }
    if (poller) {
      clearInterval(poller);
      poller = undefined;
    }
  };

  return { key, listeners, dispose };
}

/**
 * Replay the current file content to a single listener before it joins the
 * shared fs.watch stream. Idempotent and safe if the file does not exist.
 */
async function replayInitial(input: NativeLiveSubscription, listener: Listener): Promise<void> {
  const file = await resolveFile(input);
  if (!file) return;
  try {
    const content = await fsp.readFile(file, "utf8");
    const lines = input.tool === "gemini"
      ? geminiBlobToLines(content)
      : splitJsonlChunk(content);
    for (const line of lines) {
      try {
        listener(wrapOutput(line));
      } catch {
        /* listener errors shouldn't halt replay */
      }
    }
  } catch {
    // File may have been rotated mid-read; the live watcher will catch up.
  }
}

export function subscribeNativeLive(
  input: NativeLiveSubscription,
  onLine: Listener,
): () => void {
  const key = keyFor(input);
  let watch = watches.get(key);
  if (!watch) {
    watch = startWatch(input, key);
    watches.set(key, watch);
  }
  watch.listeners.add(onLine);
  void replayInitial(input, onLine);
  log(`[native-live] subscribed ${key} (listeners=${watch.listeners.size})`);

  return () => {
    const current = watches.get(key);
    if (!current) return;
    current.listeners.delete(onLine);
    log(`[native-live] unsubscribed ${key} (listeners=${current.listeners.size})`);
    if (current.listeners.size === 0) {
      current.dispose();
      watches.delete(key);
    }
  };
}

/**
 * Parse a bridge-subscribed sessionId like "claude:abc123" into the pieces the
 * live watcher needs. Returns null if the id is not a native-session id.
 */
export function parseNativeSessionId(sessionId: string): { tool: NativeTool; resumeId: string } | null {
  const match = /^(claude|codex|gemini):([^\s]+)$/i.exec(sessionId);
  if (!match) return null;
  return {
    tool: match[1]!.toLowerCase() as NativeTool,
    resumeId: match[2]!,
  };
}
