import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { daemonDir, log, logError } from "./utils.js";
import * as sm from "./sessionManager.js";
import * as os from "node:os";
import type { IpcRequest, IpcResponse, Tool, FsEntry, DaemonSettings, PromptRecord, DiffFileRecord, PortEntryRecord, TeamRecord, TeamMember, TeamTaskRecord, TeamMessageRecord, ScheduleRecord } from "./types.js";
import { execSync } from "node:child_process";
import { listNativeSessionsForWorkspace, mergeWorkspaceSessions } from "./nativeHistory/index.js";
import { readHistoryForDaemonSession, readHistoryForNativeSession } from "./historyStore.js";
import { listCodexModels } from "./codexModels.js";
import { loadState, saveState } from "./stateStore.js";
import { readOutputLines } from "./outputStore.js";
import type { DaemonState, SessionRecord } from "./types.js";

const SOCKET_NAME = "daemon.sock";
const TEAM_REPLY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SETTINGS: DaemonSettings = {
  language: "en",
  voiceLang: "en-US",
  showToolDetails: true,
  pollInterval: 2500,
  showHiddenFiles: false,
  sttProvider: "soniox",
  sttApiKey: "",
};

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
      let newlineIdx = data.indexOf("\n");
      while (newlineIdx !== -1) {
        const line = data.slice(0, newlineIdx);
        data = data.slice(newlineIdx + 1);
        handleRequest(line, conn);
        newlineIdx = data.indexOf("\n");
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

  const t0 = Date.now();
  const cmdLabel = String(req.cmd ?? "unknown");
  log(`IPC request: ${cmdLabel} id=${(req as Record<string, unknown>)["id"] ?? "-"}`);

  void routeCommand(req)
    .then((response) => {
      log(`IPC response: ${cmdLabel} ok=${response.ok} +${Date.now() - t0}ms`);
      respond(conn, response);
    })
    .catch((err) => {
      log(`IPC error: ${cmdLabel} +${Date.now() - t0}ms err=${err instanceof Error ? err.message : String(err)}`);
      respond(conn, { ok: false, error: err instanceof Error ? err.message : String(err) });
    });
}

function respond(conn: net.Socket, res: IpcResponse): void {
  conn.end(JSON.stringify(res) + "\n");
}

/**
 * Resolve a user-provided path to an absolute path, ensuring it stays
 * within the user's home directory.  Returns null if the path is unsafe.
 */
function resolveSafePath(rawPath: string): string | null {
  if (rawPath.includes("..")) return null;
  const home = os.homedir();
  // Expand ~ to home directory
  const expanded = rawPath.startsWith("~") ? path.join(home, rawPath.slice(1)) : rawPath;
  const resolved = path.resolve(expanded);
  // Must be within home directory
  if (!resolved.startsWith(home)) return null;
  return resolved;
}

function sharedState(): DaemonState {
  return sm.getState();
}

function persistSharedState(): void {
  sm.persist();
}

function normalizeSttProvider(_provider?: string | null): DaemonSettings["sttProvider"] {
  return "soniox";
}

function normalizeSettings(settings?: Partial<DaemonSettings> | null): DaemonSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  return {
    ...merged,
    sttProvider: normalizeSttProvider(settings?.sttProvider ?? merged.sttProvider),
    sttApiKey: typeof merged.sttApiKey === "string" ? merged.sttApiKey : "",
  };
}

function resolveTeamId(req: IpcRequest): string | undefined {
  if (typeof req.teamId === "string" && req.teamId.length > 0) return req.teamId;
  if (typeof req.id === "string" && req.id.length > 0) return req.id;
  return undefined;
}

function resolveTeamWorkingDirectory(req: IpcRequest): string | undefined {
  if (typeof req.workingDirectory === "string" && req.workingDirectory.length > 0) {
    return req.workingDirectory;
  }
  if (typeof req.cwd === "string" && req.cwd.length > 0) {
    return req.cwd;
  }
  return undefined;
}

function appendTeamMessage(
  state: DaemonState,
  input: {
    teamId: string;
    from: string;
    fromTool?: string;
    text: string;
    createdAt?: string;
    sessionId?: string;
  },
): TeamMessageRecord {
  if (!state.teamMessages) state.teamMessages = [];
  const msg: TeamMessageRecord = {
    from: input.from,
    fromTool: input.fromTool,
    to: input.teamId,
    text: input.text,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sessionId: input.sessionId,
  };
  state.teamMessages.push(msg);
  return msg;
}

function buildTeamList(state: DaemonState) {
  return (state.teams ?? []).map((team) => {
    const tasks = (state.teamTasks ?? []).filter((task) => task.teamId === team.id);
    const tasksDone = tasks.filter((task) => task.status === "DONE" || task.status === "APPROVED").length;
    return {
      id: team.id,
      name: team.name,
      members: team.members,
      workingDirectory: team.workingDirectory,
      createdAt: team.createdAt,
      memberCount: team.members.length,
      taskCount: tasks.length,
      activeCount: tasks.filter((task) => task.status === "IN PROGRESS").length,
      tasksDone,
      tasksTotal: tasks.length,
    };
  });
}

function findTeamMember(team: TeamRecord, memberName: string | undefined): TeamMember | undefined {
  if (!memberName) return undefined;
  return team.members.find((member) => member.name === memberName);
}

function findOwnerTool(state: DaemonState, teamId: string, owner?: string, ownerTool?: string): Tool | undefined {
  if (ownerTool === "claude" || ownerTool === "codex" || ownerTool === "gemini") return ownerTool;
  const team = (state.teams ?? []).find((entry) => entry.id === teamId);
  if (!team) return undefined;
  const member = findTeamMember(team, owner);
  return member?.tool;
}

function ensureTeamMemberSession(team: TeamRecord, member: TeamMember): SessionRecord | undefined {
  if (member.sessionId) {
    const existing = sm.getSession(member.sessionId);
    if (existing) return existing;
  }
  if (!team.workingDirectory) return undefined;
  const session = sm.createSession(member.tool, team.workingDirectory, undefined, true);
  member.sessionId = session.id;
  persistSharedState();
  return session;
}

function pushReplyChunk(chunks: string[], text: unknown): void {
  if (typeof text !== "string") return;
  const trimmed = text.trim();
  if (!trimmed) return;
  if (chunks[chunks.length - 1] !== trimmed) {
    chunks.push(trimmed);
  }
}

function extractReplyText(rawLines: string[]): string {
  const chunks: string[] = [];
  const stderr: string[] = [];

  for (const rawLine of rawLines) {
    let wrapper: Record<string, unknown>;
    try {
      wrapper = JSON.parse(rawLine) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (wrapper.t === "e") {
      pushReplyChunk(stderr, wrapper.line);
      continue;
    }
    if (wrapper.t !== "o" || typeof wrapper.line !== "string") continue;

    const stdoutLine = wrapper.line.trim();
    if (!stdoutLine) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(stdoutLine) as Record<string, unknown>;
    } catch {
      pushReplyChunk(chunks, stdoutLine);
      continue;
    }

    if (obj.type === "assistant") {
      const message = obj.message;
      if (!message || typeof message !== "object" || Array.isArray(message)) continue;
      const content = (message as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || typeof block !== "object" || Array.isArray(block)) continue;
        const typedBlock = block as Record<string, unknown>;
        if (typedBlock.type === "text") {
          pushReplyChunk(chunks, typedBlock.text);
        }
      }
      continue;
    }

    if (obj.type === "item.completed" || obj.type === "item.created") {
      const item = obj.item;
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const typedItem = item as Record<string, unknown>;
      const itemType = typedItem.type;
      if (itemType === "agent_message" || itemType === "message") {
        if (typeof typedItem.text === "string") {
          pushReplyChunk(chunks, typedItem.text);
          continue;
        }
        const content = typedItem.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (!block || typeof block !== "object" || Array.isArray(block)) continue;
          const typedBlock = block as Record<string, unknown>;
          if (typedBlock.type === "output_text" || typedBlock.type === "text") {
            pushReplyChunk(chunks, typedBlock.text);
          }
        }
      }
      continue;
    }

    if (typeof obj.response === "string") {
      pushReplyChunk(chunks, obj.response);
      continue;
    }
    if (obj.type === "text" && typeof obj.text === "string") {
      pushReplyChunk(chunks, obj.text);
    }
  }

  if (chunks.length > 0) return chunks.join("\n\n");
  return stderr[stderr.length - 1] ?? "";
}

function appendFallbackTeamReply(
  teamId: string,
  member: TeamMember,
  text: string,
  sessionId?: string,
): void {
  const state = sharedState();
  appendTeamMessage(state, {
    teamId,
    from: member.name,
    fromTool: member.tool,
    text,
    sessionId,
  });
  persistSharedState();
}

function queueTeamMemberReply(teamId: string, memberName: string, prompt: string): void {
  void (async () => {
    const state = sharedState();
    const team = (state.teams ?? []).find((entry) => entry.id === teamId);
    if (!team) return;
    const member = findTeamMember(team, memberName);
    if (!member) return;

    const session = ensureTeamMemberSession(team, member);
    if (!session) {
      appendFallbackTeamReply(teamId, member, `[${member.role}] Session unavailable. Set a team working directory first.`);
      return;
    }

    const startingOffset = session.outputLines;
    const sendRes = sm.sendTurn(session.id, prompt);
    if (!sendRes.ok) {
      const message = sendRes.error ?? "Unable to start session reply";
      appendFallbackTeamReply(teamId, member, `[${member.role}] ${message}`, session.id);
      return;
    }

    const waitRes = await sm.waitForIdle(session.id, TEAM_REPLY_TIMEOUT_MS);
    if (!waitRes.ok) {
      appendFallbackTeamReply(teamId, member, `[${member.role}] ${waitRes.error ?? "Reply failed"}`, session.id);
      return;
    }
    if (waitRes.timedOut) {
      appendFallbackTeamReply(teamId, member, `[${member.role}] Still working on it...`, session.id);
      return;
    }

    const replyText = extractReplyText(readOutputLines(session.id, startingOffset));
    const latestSession = sm.getSession(session.id);
    const message = replyText
      || latestSession?.lastTurn?.error
      || `[${member.role}] Reply completed.`;

    const latestState = sharedState();
    const latestTeam = (latestState.teams ?? []).find((entry) => entry.id === teamId);
    const latestMember = findTeamMember(latestTeam ?? team, member.name) ?? member;
    appendTeamMessage(latestState, {
      teamId,
      from: latestMember.name,
      fromTool: latestMember.tool,
      text: message,
      sessionId: session.id,
    });
    persistSharedState();
  })();
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
      const turnOpts: { mode?: string; model?: string } = {};
      if (typeof req.mode === "string") turnOpts.mode = req.mode;
      if (typeof req.model === "string") turnOpts.model = req.model;
      return sm.sendTurn(id, prompt, turnOpts);
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
      const startedAt = Date.now();
      const daemonSessions = sm.listSessions();
      const nativeSessions = await listNativeSessionsForWorkspace({ cwd, tool: "all" });
      const sessions = mergeWorkspaceSessions({
        cwd,
        daemonSessions,
        nativeSessions,
      });
      log(
        `session.list_workspace cwd=${cwd} daemon=${daemonSessions.length} native=${nativeSessions.length} merged=${sessions.length} elapsedMs=${Date.now() - startedAt}`,
      );
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

    case "model.list": {
      const tool = req.tool as string | undefined;
      if (tool !== "codex") {
        return { ok: false, error: "Unsupported tool. Expected codex." };
      }
      const models = await listCodexModels();
      return { ok: true, models };
    }

    case "config.setPushToken": {
      const token = req.token as string | undefined;
      if (!token || typeof token !== "string") {
        return { ok: false, error: "Missing required: token" };
      }
      if (!/^ExponentPushToken\[.+\]$/.test(token)) {
        return { ok: false, error: "Invalid push token format" };
      }
      sm.setPushToken(token);
      return { ok: true };
    }

    // ── File System ──

    case "fs.list": {
      const rawPath = req.path as string | undefined;
      if (!rawPath) return { ok: false, error: "Missing required: path" };
      const resolved = resolveSafePath(rawPath);
      if (!resolved) return { ok: false, error: "Invalid path: traversal not allowed" };
      try {
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) return { ok: false, error: "Not a directory" };
        const names = fs.readdirSync(resolved);
        const entries: FsEntry[] = [];
        for (const name of names) {
          try {
            const childPath = path.join(resolved, name);
            const childStat = fs.statSync(childPath);
            entries.push({
              name,
              type: childStat.isDirectory() ? "dir" : "file",
              size: childStat.size,
              modifiedAt: childStat.mtime.toISOString(),
            });
          } catch {
            // Skip entries we can't stat (permission errors, etc.)
          }
        }
        return { ok: true, entries };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "fs.read": {
      const rawPath = req.path as string | undefined;
      if (!rawPath) return { ok: false, error: "Missing required: path" };
      const resolved = resolveSafePath(rawPath);
      if (!resolved) return { ok: false, error: "Invalid path: traversal not allowed" };
      try {
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) return { ok: false, error: "Not a file" };
        const content = fs.readFileSync(resolved, "utf-8");
        const allLines = content.split("\n");
        const offset = typeof req.offset === "number" ? req.offset : 0;
        const limit = typeof req.limit === "number" ? req.limit : 200;
        const sliced = allLines.slice(offset, offset + limit);
        return {
          ok: true,
          fileContent: {
            content: sliced.join("\n"),
            totalLines: allLines.length,
            truncated: offset + limit < allLines.length,
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "fs.stat": {
      const rawPath = req.path as string | undefined;
      if (!rawPath) return { ok: false, error: "Missing required: path" };
      const resolved = resolveSafePath(rawPath);
      if (!resolved) return { ok: false, error: "Invalid path: traversal not allowed" };
      try {
        const s = fs.statSync(resolved);
        const perms = "0" + (s.mode & 0o777).toString(8);
        return {
          ok: true,
          stat: {
            name: path.basename(resolved),
            type: s.isDirectory() ? "dir" : "file",
            size: s.size,
            modifiedAt: s.mtime.toISOString(),
            permissions: perms,
          },
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // ── Session Diffs ──

    case "session.diffs": {
      const id = req.id as string | undefined;
      if (!id) return { ok: false, error: "Missing required: id" };
      const session = sm.getSession(id);
      if (!session) return { ok: false, error: `Session ${id} not found` };

      const cwd = session.workingDirectory;
      const files: DiffFileRecord[] = [];

      try {
        // Get tracked file changes
        const diffStat = execSync("git diff HEAD --stat --numstat", {
          cwd,
          encoding: "utf-8",
          timeout: 10000,
        }).trim();

        if (diffStat) {
          for (const line of diffStat.split("\n")) {
            const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
            if (match) {
              files.push({
                path: match[3].trim(),
                added: match[1] === "-" ? 0 : parseInt(match[1], 10),
                removed: match[2] === "-" ? 0 : parseInt(match[2], 10),
                isNew: false,
              });
            }
          }
        }

        // Get untracked files
        const untracked = execSync("git ls-files --others --exclude-standard", {
          cwd,
          encoding: "utf-8",
          timeout: 10000,
        }).trim();

        if (untracked) {
          for (const filePath of untracked.split("\n")) {
            if (filePath.trim()) {
              // Count lines in new file
              let lineCount = 0;
              try {
                const content = fs.readFileSync(path.join(cwd, filePath.trim()), "utf-8");
                lineCount = content.split("\n").length;
              } catch { /* ignore */ }
              files.push({
                path: filePath.trim(),
                added: lineCount,
                removed: 0,
                isNew: true,
              });
            }
          }
        }
      } catch (err) {
        log(`session.diffs error: ${err instanceof Error ? err.message : String(err)}`);
      }

      return { ok: true, files };
    }

    case "session.diff_file": {
      const id = req.id as string | undefined;
      const filePath = req.path as string | undefined;
      if (!id) return { ok: false, error: "Missing required: id" };
      if (!filePath) return { ok: false, error: "Missing required: path" };
      const session = sm.getSession(id);
      if (!session) return { ok: false, error: `Session ${id} not found` };

      const cwd = session.workingDirectory;
      try {
        // Check if the file is untracked (new)
        const untrackedCheck = execSync("git ls-files --others --exclude-standard", {
          cwd,
          encoding: "utf-8",
          timeout: 10000,
        }).trim();
        const isUntracked = untrackedCheck.split("\n").some((f) => f.trim() === filePath);

        let content: string;
        if (isUntracked) {
          // For new files, show the entire content as added
          const fileContent = fs.readFileSync(path.join(cwd, filePath), "utf-8");
          const lines = fileContent.split("\n");
          content = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n` +
            lines.map((l) => `+${l}`).join("\n");
        } else {
          content = execSync(`git diff HEAD -- ${JSON.stringify(filePath)}`, {
            cwd,
            encoding: "utf-8",
            timeout: 10000,
          });
        }
        return { ok: true, content };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // ── Settings ──

    case "settings.get": {
      const state = loadState();
      const settings = normalizeSettings(state.settings);
      return { ok: true, settings };
    }

    case "settings.set": {
      const requestedSettings = req.settings as Partial<DaemonSettings> | undefined;
      if (!requestedSettings) return { ok: false, error: "Missing required: settings" };
      const newSettings = normalizeSettings(requestedSettings);
      const state = loadState();
      state.settings = newSettings;
      saveState(state);
      log(`Settings updated: ${JSON.stringify(newSettings)}`);
      return { ok: true, settings: newSettings };
    }

    // ── Prompts ──

    case "prompt.list": {
      const state = loadState();
      if (!state.prompts || state.prompts.length === 0) {
        // Seed built-in prompts on first access
        state.prompts = defaultPrompts();
        saveState(state);
      }
      return { ok: true, prompts: state.prompts };
    }

    case "prompt.add": {
      const label = req.label as string | undefined;
      const promptText = req.prompt as string | undefined;
      if (!label || !promptText) return { ok: false, error: "Missing required: label, prompt" };
      const prompt: PromptRecord = {
        id: crypto.randomUUID(),
        label,
        prompt: promptText,
        isBuiltIn: false,
      };
      const state = loadState();
      if (!state.prompts) state.prompts = defaultPrompts();
      state.prompts.push(prompt);
      saveState(state);
      log(`Prompt added: ${label}`);
      return { ok: true, prompt };
    }

    case "prompt.remove": {
      const promptId = req.id as string | undefined;
      if (!promptId) return { ok: false, error: "Missing required: id" };
      const state = loadState();
      if (!state.prompts) return { ok: false, error: "No prompts configured" };
      const idx = state.prompts.findIndex((p) => p.id === promptId);
      if (idx === -1) return { ok: false, error: `Prompt ${promptId} not found` };
      state.prompts.splice(idx, 1);
      saveState(state);
      log(`Prompt removed: ${promptId}`);
      return { ok: true };
    }

    // ── Ports ──

    case "ports.list": {
      const ports: PortEntryRecord[] = [];
      try {
        // macOS: lsof, Linux: ss
        const isMac = os.platform() === "darwin";
        const cmd = isMac
          ? "lsof -iTCP -sTCP:LISTEN -P -n"
          : "ss -tlnp";

        const output = execSync(cmd, {
          encoding: "utf-8",
          timeout: 10000,
        }).trim();

        const lines = output.split("\n").slice(1); // skip header

        if (isMac) {
          // lsof format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
          const seen = new Set<number>();
          for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length < 9) continue;
            const nameField = parts[parts.length - 1]; // e.g. *:3000 or 127.0.0.1:8080
            const portMatch = nameField.match(/:(\d+)$/);
            if (!portMatch) continue;
            const port = parseInt(portMatch[1], 10);
            if (seen.has(port)) continue;
            seen.add(port);
            ports.push({
              port,
              process: parts[0],
              pid: parseInt(parts[1], 10) || 0,
              address: nameField.replace(`:${port}`, '') || '*',
            });
          }
        } else {
          // ss format: State Recv-Q Send-Q Local_Address:Port Peer_Address:Port Process
          for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length < 5) continue;
            const localAddr = parts[3]; // e.g. 0.0.0.0:3000 or *:8080
            const portMatch = localAddr.match(/:(\d+)$/);
            if (!portMatch) continue;
            const port = parseInt(portMatch[1], 10);
            const processField = parts[5] ?? "";
            const procMatch = processField.match(/users:\(\("([^"]+)",pid=(\d+)/);
            ports.push({
              port,
              process: procMatch ? procMatch[1] : "unknown",
              pid: procMatch ? parseInt(procMatch[2], 10) : 0,
              address: localAddr.replace(`:${port}`, '') || '*',
            });
          }
        }
      } catch (err) {
        log(`ports.list error: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Sort by port number
      ports.sort((a, b) => a.port - b.port);
      return { ok: true, ports };
    }

    // ── Bridge QR (Phase 8) ──

    case "bridge.qr": {
      const bridgeHost = req.host as string | undefined ?? os.hostname();
      const bridgePort = typeof req.port === "number" ? req.port : 7842;

      // Read token from bridge dir
      const tokenPath = path.join(os.homedir(), ".openvide-daemon", "bridge", "token.txt");
      let token = "";
      try {
        token = fs.readFileSync(tokenPath, "utf-8").trim();
      } catch {
        return { ok: false, error: "Bridge token not found. Start the bridge first." };
      }

      const url = `openvide://${bridgeHost}:${bridgePort}?token=${token}`;
      return { ok: true, url };
    }

    // ── Teams ──

    case "team.list": {
      const state = sharedState();
      const teams = buildTeamList(state);
      return { ok: true, teams };
    }

    case "team.get": {
      const teamId = resolveTeamId(req);
      if (!teamId) return { ok: false, error: "Missing required: id" };
      const state = sharedState();
      const team = (state.teams ?? []).find(t => t.id === teamId);
      if (!team) return { ok: false, error: `Team ${teamId} not found` };
      return { ok: true, team };
    }

    case "team.create": {
      const name = req.name as string | undefined;
      const members = req.members as TeamMember[] | undefined;
      const workingDirectory = resolveTeamWorkingDirectory(req);
      if (!name) return { ok: false, error: "Missing required: name" };
      const state = sharedState();
      if (!state.teams) state.teams = [];
      const team: TeamRecord = {
        id: crypto.randomUUID(),
        name,
        members: members ?? [],
        workingDirectory,
        createdAt: new Date().toISOString(),
      };
      state.teams.push(team);
      persistSharedState();
      log(`Team created: ${name} (${team.id})`);
      return { ok: true, team };
    }

    case "team.delete": {
      const teamId = resolveTeamId(req);
      if (!teamId) return { ok: false, error: "Missing required: id" };
      const state = sharedState();
      if (!state.teams) return { ok: false, error: `Team ${teamId} not found` };
      const idx = state.teams.findIndex(t => t.id === teamId);
      if (idx === -1) return { ok: false, error: `Team ${teamId} not found` };
      state.teams.splice(idx, 1);
      // Clean up tasks and messages
      state.teamTasks = (state.teamTasks ?? []).filter(t => t.teamId !== teamId);
      state.teamMessages = (state.teamMessages ?? []).filter((m) => m.to !== teamId && m.to !== `team:${teamId}`);
      persistSharedState();
      log(`Team deleted: ${teamId}`);
      return { ok: true };
    }

    case "team.task.list": {
      const teamId = req.teamId as string | undefined;
      if (!teamId) return { ok: false, error: "Missing required: teamId" };
      const state = sharedState();
      const teamTasks = (state.teamTasks ?? []).filter(t => t.teamId === teamId);
      return { ok: true, teamTasks };
    }

    case "team.task.create": {
      const teamId = req.teamId as string | undefined;
      const subject = req.subject as string | undefined;
      if (!teamId || !subject) return { ok: false, error: "Missing required: teamId, subject" };
      const state = sharedState();
      if (!state.teamTasks) state.teamTasks = [];
      const owner = req.owner as string | undefined;
      const ownerTool = findOwnerTool(state, teamId, owner, req.ownerTool as Tool | undefined);
      const task: TeamTaskRecord = {
        id: crypto.randomUUID(),
        teamId,
        subject,
        description: req.description as string | undefined,
        owner,
        ownerTool,
        status: 'TODO',
        createdAt: new Date().toISOString(),
      };
      state.teamTasks.push(task);
      persistSharedState();
      log(`Task created: ${subject} in team ${teamId}`);
      return { ok: true, task };
    }

    case "team.task.update": {
      const teamId = req.teamId as string | undefined;
      const taskId = req.taskId as string | undefined;
      if (!teamId || !taskId) return { ok: false, error: "Missing required: teamId, taskId" };
      const state = sharedState();
      const task = (state.teamTasks ?? []).find(t => t.id === taskId && t.teamId === teamId);
      if (!task) return { ok: false, error: `Task ${taskId} not found` };
      if (typeof req.status === 'string') task.status = req.status;
      if (typeof req.owner === 'string') {
        task.owner = req.owner;
        task.ownerTool = findOwnerTool(state, teamId, req.owner, req.ownerTool as Tool | undefined);
      }
      if (typeof req.subject === 'string') task.subject = req.subject;
      persistSharedState();
      log(`Task updated: ${taskId} status=${task.status}`);
      return { ok: true, task };
    }

    case "team.message.list": {
      const teamId = req.teamId as string | undefined;
      if (!teamId) return { ok: false, error: "Missing required: teamId" };
      const limit = typeof req.limit === 'number' ? req.limit : 50;
      const state = sharedState();
      const allMessages = (state.teamMessages ?? []).filter(m => m.to === teamId || m.to === `team:${teamId}`);
      const teamMessages = allMessages.slice(-limit);
      return { ok: true, teamMessages };
    }

    case "team.message.send": {
      const teamId = req.teamId as string | undefined;
      const text = req.text as string | undefined;
      if (!teamId || !text) return { ok: false, error: "Missing required: teamId, text" };
      const from = (req.from as string | undefined) ?? 'user';
      const fromTool = req.fromTool as string | undefined;
      const state = sharedState();
      appendTeamMessage(state, {
        teamId,
        from,
        fromTool,
        text,
      });

      // Fan out the message to team member sessions and mirror their replies back into chat.
      const team = (state.teams ?? []).find(t => t.id === teamId);
      if (team && from === 'user') {
        for (const member of team.members) {
          queueTeamMemberReply(teamId, member.name, text);
        }
      }

      persistSharedState();
      log(`Team message: ${from} → ${teamId}: ${text.slice(0, 50)}`);
      return { ok: true };
    }

    // ── Schedules ──

    case "schedule.list": {
      const state = loadState();
      const schedules = state.schedules ?? [];
      return { ok: true, schedules };
    }

    case "schedule.create": {
      const name = req.name as string | undefined;
      const schedule = req.schedule as string | undefined;
      if (!name || !schedule) return { ok: false, error: "Missing required: name, schedule" };
      const state = loadState();
      if (!state.schedules) state.schedules = [];
      const entry: ScheduleRecord = {
        id: crypto.randomUUID(),
        name,
        schedule,
        project: req.project as string | undefined,
      };
      state.schedules.push(entry);
      saveState(state);
      log(`Schedule created: ${name} (${schedule})`);
      return { ok: true, schedule: entry };
    }

    case "schedule.run": {
      const taskId = req.taskId as string | undefined;
      if (!taskId) return { ok: false, error: "Missing required: taskId" };
      const state = loadState();
      const entry = (state.schedules ?? []).find(s => s.id === taskId);
      if (!entry) return { ok: false, error: `Schedule ${taskId} not found` };
      entry.lastRun = new Date().toISOString();
      entry.lastStatus = 'success';
      saveState(state);
      log(`Schedule run: ${entry.name}`);
      return { ok: true };
    }

    case "schedule.delete": {
      const scheduleId = req.id as string | undefined;
      if (!scheduleId) return { ok: false, error: "Missing required: id" };
      const state = loadState();
      if (!state.schedules) return { ok: false, error: `Schedule ${scheduleId} not found` };
      const idx = state.schedules.findIndex(s => s.id === scheduleId);
      if (idx === -1) return { ok: false, error: `Schedule ${scheduleId} not found` };
      state.schedules.splice(idx, 1);
      saveState(state);
      log(`Schedule deleted: ${scheduleId}`);
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

/** Built-in prompt templates seeded on first access. */
function defaultPrompts(): PromptRecord[] {
  return [
    { id: "builtin_explain", label: "Explain", prompt: "Explain the current code and what it does", isBuiltIn: true },
    { id: "builtin_changes", label: "Show changes", prompt: "Show me the recent changes made to the codebase", isBuiltIn: true },
    { id: "builtin_tests", label: "Run tests", prompt: "Run the test suite and report results", isBuiltIn: true },
    { id: "builtin_continue", label: "Continue", prompt: "Continue where you left off", isBuiltIn: true },
    { id: "builtin_undo", label: "Undo", prompt: "Undo the last change you made", isBuiltIn: true },
    { id: "builtin_review", label: "Review", prompt: "Review the code for issues and improvements", isBuiltIn: true },
    { id: "builtin_refactor", label: "Refactor", prompt: "Refactor the current code for better readability and maintainability", isBuiltIn: true },
    { id: "builtin_status", label: "Status", prompt: "Show the current project status including git status and any running processes", isBuiltIn: true },
    { id: "builtin_commit", label: "Commit", prompt: "Create a git commit with a descriptive message for the current changes", isBuiltIn: true },
    { id: "builtin_error", label: "Explain error", prompt: "Explain the last error and suggest a fix", isBuiltIn: true },
  ];
}

// ── Client (runs in CLI process) ──

export function sendCommand(req: IpcRequest, timeoutMs = 30000): Promise<IpcResponse> {
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
      // Clear the inactivity timeout so it doesn't keep the event loop alive.
      conn.setTimeout(0);
      try {
        resolve(JSON.parse(data) as IpcResponse);
      } catch {
        reject(new Error("Invalid response from daemon"));
      }
    });

    conn.on("error", (err) => {
      reject(err);
    });

    conn.setTimeout(timeoutMs, () => {
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
