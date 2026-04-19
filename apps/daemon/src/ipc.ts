import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as child_process from "node:child_process";
import * as os from "node:os";
import { DAEMON_CAPABILITIES, DAEMON_VERSION } from "./buildInfo.js";
import { daemonDir, log, logError } from "./utils.js";
import * as sm from "./sessionManager.js";
import type { IpcRequest, IpcResponse, Tool, BridgeConfig, BridgeConfigSnapshot } from "./types.js";
import { listNativeSessionsCatalog, listNativeSessionsForWorkspace, mergeDiscoveredSessions, mergeWorkspaceSessions } from "./nativeHistory/index.js";
import { readHistoryForDaemonSession, readHistoryForNativeSession } from "./historyStore.js";
import { listCodexModels } from "./codexModels.js";
import { generateSecret, createJwt, parseDuration } from "./jwt.js";
import { startBridge, stopBridge, isBridgeRunning, getBridgeInfo, updateBridgeConfig, getLocalIp } from "./bridgeServer.js";
import { detectTailscaleIp, detectTailscaleHostname, getTailscaleTls } from "./certs.js";
import { encodeQR } from "./qrText.js";
import * as tm from "./teamManager.js";
import * as sched from "./scheduleManager.js";

const SOCKET_NAME = "daemon.sock";

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

function snapshotBridgeConfig(config: BridgeConfig): BridgeConfigSnapshot {
  return {
    enabled: config.enabled === true,
    port: typeof config.port === "number" ? config.port : 7842,
    tls: config.tls !== false,
    bindHost: config.bindHost?.trim() || "::",
    defaultCwd: config.defaultCwd?.trim() || os.homedir(),
    evenAiTool:
      config.evenAiTool === "codex" || config.evenAiTool === "gemini"
        ? config.evenAiTool
        : "claude",
    evenAiMode:
      config.evenAiMode === "new" || config.evenAiMode === "pinned"
        ? config.evenAiMode
        : "last",
    evenAiPinnedSessionId: config.evenAiPinnedSessionId ?? "",
    currentEvenAiSessionId: config.currentEvenAiSessionId ?? "",
  };
}

/** Check which CLI tools are installed on this host. */
async function detectInstalledTools(): Promise<Record<string, boolean>> {
  const tools = ["claude", "codex", "gemini"];
  const results: Record<string, boolean> = {};
  await Promise.all(
    tools.map(async (tool) => {
      try {
        await new Promise<void>((resolve, reject) => {
          child_process.exec(`command -v ${tool}`, { timeout: 3000 }, (err) => {
            err ? reject(err) : resolve();
          });
        });
        results[tool] = true;
      } catch {
        results[tool] = false;
      }
    }),
  );
  return results;
}

export async function routeCommand(req: IpcRequest): Promise<IpcResponse> {
  switch (req.cmd) {
    case "health": {
      const sessions = sm.listSessions();
      const tools = await detectInstalledTools();
      return {
        ok: true,
        version: DAEMON_VERSION,
        pid: process.pid,
        name: os.hostname(),
        daemonPath: process.argv[1] ? path.resolve(process.argv[1]) : "",
        nodeVersion: process.version,
        capabilities: DAEMON_CAPABILITIES,
        activeSessions: sm.getActiveCount(),
        totalSessions: sessions.length,
        tools,
      };
    }

    case "prompt.list": {
      return { ok: true, prompts: sm.listPrompts() };
    }

    case "prompt.add": {
      const label = typeof req.label === "string" ? req.label.trim() : "";
      const prompt = typeof req.prompt === "string" ? req.prompt.trim() : "";
      if (!label || !prompt) {
        return { ok: false, error: "Missing required: label, prompt" };
      }
      const record = sm.addPrompt(label, prompt);
      return { ok: true, prompts: sm.listPrompts(), prompt: record };
    }

    case "prompt.remove": {
      const id = typeof req.id === "string" ? req.id.trim() : "";
      if (!id) {
        return { ok: false, error: "Missing required: id" };
      }
      const removed = sm.removePrompt(id);
      if (!removed) {
        return { ok: false, error: `Prompt ${id} not found` };
      }
      return { ok: true, prompts: sm.listPrompts() };
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

    case "session.catalog": {
      const startedAt = Date.now();
      const daemonSessions = sm.listSessions();
      const nativeSessions = await listNativeSessionsCatalog({ tool: "all" });
      const sessions = mergeDiscoveredSessions({
        daemonSessions,
        nativeSessions,
      });
      log(
        `session.catalog daemon=${daemonSessions.length} native=${nativeSessions.length} merged=${sessions.length} elapsedMs=${Date.now() - startedAt}`,
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

    case "session.suggest": {
      // Deprecated: AI-generated suggestions were removed to stop spurious CLI
      // spawns. Quick prompts now live in the user's configured prompt library
      // (prompt.list). Return empty for backwards-compat.
      return { ok: true, suggestions: [], suggestionSource: "heuristic", suggestionsCached: false };
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

      try {
        const history = await readHistoryForNativeSession({ tool, resumeId, cwd, limitLines });
        return { ok: true, history };
      } catch (err) {
        // Surface the error to the client but never throw — a broken or
        // missing native history file must not drop the bridge connection.
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
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

    case "stop": {
      log("Received stop command via IPC");
      // Respond first, then exit
      setTimeout(async () => {
        await sm.shutdownAll();
        process.exit(0);
      }, 100);
      return { ok: true };
    }

    // ── Bridge commands ──

    case "bridge.enable": {
      const state = sm.getState();
      const port = typeof req.port === "number" ? req.port : 7842;
      const tls = req.tls !== false; // default true — auto-uses Tailscale cert if available
      const bindHost = typeof req.bindHost === "string" && req.bindHost.trim()
        ? req.bindHost.trim()
        : undefined;

      if (!state.bridge) {
        const secret = generateSecret();
        state.bridge = {
          enabled: true,
          port,
          tls,
          bindHost,
          secretKey: secret.toString("hex"),
          revokedTokens: [],
        };
      } else {
        state.bridge.enabled = true;
        state.bridge.port = port;
        state.bridge.tls = tls;
        if (bindHost) state.bridge.bindHost = bindHost;
        if (!state.bridge.secretKey) {
          state.bridge.secretKey = generateSecret().toString("hex");
        }
      }

      sm.persist();
      startBridge(state.bridge);
      return { ok: true, bridgeStatus: getBridgeInfo() };
    }

    case "bridge.disable": {
      if (isBridgeRunning()) {
        await stopBridge();
      }
      const state = sm.getState();
      if (state.bridge) {
        state.bridge.enabled = false;
        sm.persist();
      }
      return { ok: true };
    }

    case "bridge.status": {
      return { ok: true, bridgeStatus: getBridgeInfo() };
    }

    case "bridge.token.create": {
      const state = sm.getState();
      if (!state.bridge?.secretKey) {
        return { ok: false, error: "Bridge not configured. Run bridge.enable first." };
      }
      const expireStr = typeof req.expire === "string" ? req.expire : "24h";
      let expireSeconds: number;
      try {
        expireSeconds = parseDuration(expireStr);
      } catch {
        return { ok: false, error: `Invalid expire duration: ${expireStr}` };
      }
      const { token } = createJwt(state.bridge.secretKey, {
        expireSeconds,
        extraClaims: { kind: "bootstrap" },
      });
      const localIp = getLocalIp();
      const port = state.bridge.port;
      const tsIp = detectTailscaleIp();
      const tsTls = getTailscaleTls();
      const result: IpcResponse & Record<string, unknown> = {
        ok: true,
        bridgeToken: token,
        bridgeUrl: `http://${localIp}:${port}`,
      };
      if (tsTls) {
        result.tailscaleUrl = `https://${tsTls.hostname}:${port}`;
      } else if (tsIp) {
        result.tailscaleUrl = `http://${tsIp}:${port}`;
      }
      return result;
    }

    case "bridge.token.revoke": {
      const jti = req.jti as string | undefined;
      if (!jti) return { ok: false, error: "Missing required: jti" };
      const state = sm.getState();
      if (!state.bridge) {
        return { ok: false, error: "Bridge not configured" };
      }
      if (!state.bridge.revokedTokens.includes(jti)) {
        state.bridge.revokedTokens.push(jti);
        sm.persist();
        if (isBridgeRunning()) updateBridgeConfig(state.bridge);
      }
      return { ok: true };
    }

    case "bridge.qr": {
      const state = sm.getState();
      if (!state.bridge?.secretKey) {
        return { ok: false, error: "Bridge not configured. Run bridge.enable first." };
      }
      const expStr = typeof req.expire === "string" ? req.expire : "24h";
      let expSec: number;
      try {
        expSec = parseDuration(expStr);
      } catch {
        return { ok: false, error: `Invalid expire duration: ${expStr}` };
      }
      const { token } = createJwt(state.bridge.secretKey, {
        expireSeconds: expSec,
        extraClaims: { kind: "bootstrap" },
      });
      const host = typeof req.host === "string" ? req.host : getLocalIp();
      const proto = state.bridge.tls ? "https" : "http";
      const url = `${proto}://${host}:${state.bridge.port}?token=${token}`;
      const qrLines = await encodeQR(url);
      return { ok: true, bridgeToken: token, bridgeUrl: url, qrLines };
    }

    case "bridge.config": {
      const state = sm.getState();
      if (!state.bridge) {
        return { ok: false, error: "Bridge not configured. Run bridge.enable first." };
      }
      let changed = false;
      if (typeof req.defaultCwd === "string") {
        state.bridge.defaultCwd = req.defaultCwd.trim() || undefined;
        changed = true;
      }
      if (typeof req.bindHost === "string") {
        state.bridge.bindHost = req.bindHost.trim() || undefined;
        changed = true;
      }
      if (req.evenAiTool === "claude" || req.evenAiTool === "codex" || req.evenAiTool === "gemini") {
        state.bridge.evenAiTool = req.evenAiTool;
        changed = true;
      }
      if (req.evenAiMode === "new" || req.evenAiMode === "last" || req.evenAiMode === "pinned") {
        state.bridge.evenAiMode = req.evenAiMode;
        changed = true;
      }
      if (typeof req.evenAiPinnedSessionId === "string") {
        state.bridge.evenAiPinnedSessionId = req.evenAiPinnedSessionId;
        changed = true;
      }
      if (typeof req.currentEvenAiSessionId === "string") {
        state.bridge.currentEvenAiSessionId = req.currentEvenAiSessionId;
        changed = true;
      }
      if (changed) {
        sm.persist();
        if (isBridgeRunning()) updateBridgeConfig(state.bridge);
      }
      return {
        ok: true,
        bridgeConfig: snapshotBridgeConfig(state.bridge),
        bridgeStatus: getBridgeInfo(),
      };
    }

    // ── Remote + Schedule commands ──

    case "session.remote": {
      const id = req.id as string | undefined;
      if (!id) return { ok: false, error: "Missing required: id" };
      const session = sm.getSession(id);
      if (!session) return { ok: false, error: `Session ${id} not found` };
      if (session.tool !== "claude") return { ok: false, error: "Remote control is only supported for Claude sessions" };
      const dirName = session.workingDirectory.split("/").pop() ?? "session";
      try {
        const result = await spawnClaude(["remote-control", "--name", dirName], session.workingDirectory, 15000);
        // Claude outputs a URL like "https://claude.ai/code/..." to stdout
        const urlMatch = result.stdout.match(/https:\/\/claude\.ai\/[^\s]+/);
        if (urlMatch) {
          return { ok: true, remoteUrl: urlMatch[0] };
        }
        return { ok: false, error: result.stdout || result.stderr || "No remote URL returned" };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "schedule.list": {
      return { ok: true, schedules: sched.listSchedules() };
    }

    case "schedule.get": {
      const scheduleId = req.id as string | undefined;
      if (!scheduleId) return { ok: false, error: "Missing required: id" };
      const schedule = sched.getSchedule(scheduleId);
      if (!schedule) return { ok: false, error: `Schedule ${scheduleId} not found` };
      return { ok: true, schedule };
    }

    case "schedule.create": {
      const name = req.name as string | undefined;
      const schedule = req.schedule as string | undefined;
      const target = req.target as import("./types.js").ScheduleTarget | undefined;
      if (!name || !schedule || !target) {
        return { ok: false, error: "Missing required: name, schedule, target" };
      }
      try {
        const created = sched.createSchedule({
          name,
          schedule,
          project: req.project as string | undefined,
          enabled: typeof req.enabled === "boolean" ? req.enabled : undefined,
          target,
        });
        return { ok: true, schedule: created };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "schedule.update": {
      const scheduleId = req.id as string | undefined;
      if (!scheduleId) return { ok: false, error: "Missing required: id" };
      try {
        const updated = sched.updateSchedule(scheduleId, {
          name: req.name as string | undefined,
          schedule: req.schedule as string | undefined,
          project: req.project as string | undefined,
          enabled: typeof req.enabled === "boolean" ? req.enabled : undefined,
          target: req.target as import("./types.js").ScheduleTarget | undefined,
        });
        if (!updated) return { ok: false, error: `Schedule ${scheduleId} not found` };
        return { ok: true, schedule: updated };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "schedule.delete": {
      const scheduleId = (req.id as string | undefined) ?? (req.scheduleId as string | undefined);
      if (!scheduleId) return { ok: false, error: "Missing required: id" };
      const deleted = sched.deleteSchedule(scheduleId);
      if (!deleted) return { ok: false, error: `Schedule ${scheduleId} not found` };
      return { ok: true };
    }

    case "schedule.run": {
      const taskId = req.taskId as string | undefined;
      if (!taskId) return { ok: false, error: "Missing required: taskId" };
      try {
        const { schedule, session } = await sched.runSchedule(taskId, "manual");
        return { ok: true, schedule, session };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // ── Filesystem commands ──

    case "fs.list": {
      const dirPath = req.path as string | undefined;
      if (!dirPath) return { ok: false, error: "Missing required: path" };
      const resolved = dirPath.startsWith("~")
        ? dirPath.replace("~", process.env.HOME ?? process.env.USERPROFILE ?? "")
        : dirPath;
      try {
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        const result = entries.map((e) => {
          let size = 0;
          let modifiedAt = "";
          try {
            const stat = fs.statSync(path.join(resolved, e.name));
            size = stat.size;
            modifiedAt = stat.mtime.toISOString();
          } catch { /* ignore */ }
          return {
            name: e.name,
            type: e.isDirectory() ? "dir" : "file",
            size,
            modifiedAt,
          };
        });
        return { ok: true, entries: result };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "fs.read": {
      const filePath = req.path as string | undefined;
      if (!filePath) return { ok: false, error: "Missing required: path" };
      const resolved = filePath.startsWith("~")
        ? filePath.replace("~", process.env.HOME ?? process.env.USERPROFILE ?? "")
        : filePath;
      try {
        const content = fs.readFileSync(resolved, "utf-8");
        return { ok: true, fileContent: { content } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    // ── Team commands ──

    case "team.create": {
      const name = req.name as string | undefined;
      const cwd = req.cwd as string | undefined;
      const members = req.members as Array<{ name: string; tool: string; model?: string; role: string }> | undefined;
      if (!name || !cwd || !members || !Array.isArray(members)) {
        return { ok: false, error: "Missing required: name, cwd, members" };
      }
      try {
        const team = tm.createTeam(name, cwd, members as any[]);
        return { ok: true, team };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "team.list": {
      const teams = tm.listTeams().map((team) => {
        const tasks = tm.listTasks(team.id);
        const activeCount = team.members.reduce((count, member) => {
          const session = sm.getSession(member.sessionId);
          return count + (session?.status === "running" ? 1 : 0);
        }, 0);
        const latestPlan = tm.getLatestPlan(team.id);
        return {
          ...team,
          taskCount: tasks.length,
          tasksTotal: tasks.length,
          tasksDone: tasks.filter((task) => task.status === "approved").length,
          activeCount,
          latestPlanId: latestPlan?.id,
        };
      });
      return { ok: true, teams };
    }

    case "team.get": {
      const teamId = req.teamId as string | undefined;
      if (!teamId) return { ok: false, error: "Missing required: teamId" };
      const team = tm.getTeam(teamId);
      if (!team) return { ok: false, error: `Team ${teamId} not found` };
      const tasks = tm.listTasks(team.id);
      const latestPlan = tm.getLatestPlan(team.id);
      const activeCount = team.members.reduce((count, member) => {
        const session = sm.getSession(member.sessionId);
        return count + (session?.status === "running" ? 1 : 0);
      }, 0);
      return {
        ok: true,
        team: {
          ...team,
          taskCount: tasks.length,
          tasksTotal: tasks.length,
          tasksDone: tasks.filter((task) => task.status === "approved").length,
          activeCount,
          latestPlanId: latestPlan?.id,
        },
      };
    }

    case "team.update": {
      const teamId = req.teamId as string | undefined;
      if (!teamId) return { ok: false, error: "Missing required: teamId" };
      const team = tm.updateTeam(teamId, {
        name: req.name as string | undefined,
        workingDirectory: req.cwd as string | undefined,
        members: req.members as Array<{ name: string; tool: Tool; model?: string; role: string }> | undefined,
      });
      if (!team) return { ok: false, error: `Team ${teamId} not found` };
      return { ok: true, team };
    }

    case "team.delete": {
      const teamId = req.teamId as string | undefined;
      if (!teamId) return { ok: false, error: "Missing required: teamId" };
      const deleted = tm.deleteTeam(teamId);
      if (!deleted) return { ok: false, error: `Team ${teamId} not found` };
      return { ok: true };
    }

    case "team.task.create": {
      const teamId = req.teamId as string | undefined;
      const subject = req.subject as string | undefined;
      const description = req.description as string ?? "";
      const owner = req.owner as string | undefined;
      if (!teamId || !subject) {
        return { ok: false, error: "Missing required: teamId, subject" };
      }
      try {
        const task = tm.createTask(teamId, subject, description, owner ?? "", req.dependencies as string[] | undefined);
        return { ok: true, teamTask: task };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "team.task.update": {
      const teamId = req.teamId as string | undefined;
      const taskId = req.taskId as string | undefined;
      if (!teamId || !taskId) {
        return { ok: false, error: "Missing required: teamId, taskId" };
      }
      const updates: Record<string, unknown> = {};
      if (req.status) updates.status = req.status;
      if (req.owner) updates.owner = req.owner;
      if (req.description) updates.description = req.description;
      const task = tm.updateTask(teamId, taskId, updates as any);
      if (!task) return { ok: false, error: `Task ${taskId} not found` };
      return { ok: true, teamTask: task };
    }

    case "team.task.list": {
      const teamId = req.teamId as string | undefined;
      if (!teamId) return { ok: false, error: "Missing required: teamId" };
      return { ok: true, teamTasks: tm.listTasks(teamId) };
    }

    case "team.task.comment": {
      const teamId = req.teamId as string | undefined;
      const taskId = req.taskId as string | undefined;
      const author = req.author as string ?? "user";
      const text = req.text as string | undefined;
      if (!teamId || !taskId || !text) {
        return { ok: false, error: "Missing required: teamId, taskId, text" };
      }
      const comment = tm.addComment(teamId, taskId, author, text);
      if (!comment) return { ok: false, error: `Task ${taskId} not found` };
      return { ok: true };
    }

    case "team.message.send": {
      const teamId = req.teamId as string | undefined;
      const from = req.from as string ?? "user";
      const to = req.to as string ?? "*";
      const text = req.text as string | undefined;
      if (!teamId || !text) {
        return { ok: false, error: "Missing required: teamId, text" };
      }
      try {
        tm.sendMessage(teamId, from, to, text);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "team.message.list": {
      const teamId = req.teamId as string | undefined;
      if (!teamId) return { ok: false, error: "Missing required: teamId" };
      const limit = typeof req.limit === "number" ? req.limit : undefined;
      return { ok: true, teamMessages: tm.listMessages(teamId, limit) };
    }

    case "team.plan.submit": {
      const teamId = req.teamId as string | undefined;
      const plan = req.plan as { tasks: any[] } | undefined;
      const createdBy = req.createdBy as string ?? "user";
      if (!teamId || !plan?.tasks) {
        return { ok: false, error: "Missing required: teamId, plan.tasks" };
      }
      try {
        const teamPlan = tm.submitPlan(teamId, plan.tasks, createdBy, {
          mode: req.mode as any,
          reviewers: req.reviewers as string[] | undefined,
          maxIterations: typeof req.maxIterations === "number" ? req.maxIterations : undefined,
        });
        return { ok: true, teamPlan };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "team.plan.generate": {
      const teamId = req.teamId as string | undefined;
      const request = req.request as string | undefined;
      if (!teamId || !request) {
        return { ok: false, error: "Missing required: teamId, request" };
      }
      try {
        tm.generatePlan(teamId, request, {
          mode: req.mode as any,
          reviewers: req.reviewers as string[] | undefined,
          maxIterations: typeof req.maxIterations === "number" ? req.maxIterations : undefined,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case "team.plan.review": {
      const teamId = req.teamId as string | undefined;
      const planId = req.planId as string | undefined;
      const vote = req.vote as "approve" | "revise" | "reject" | undefined;
      const reviewer = req.reviewer as string | undefined;
      if (!teamId || !planId || !vote || !reviewer) {
        return { ok: false, error: "Missing required: teamId, planId, reviewer, vote" };
      }
      const plan = tm.reviewPlan(teamId, planId, reviewer, vote, req.feedback as string | undefined);
      if (!plan) return { ok: false, error: `Plan ${planId} not found` };
      return { ok: true, teamPlan: plan };
    }

    case "team.plan.revise": {
      const teamId = req.teamId as string | undefined;
      const planId = req.planId as string | undefined;
      const revision = req.revision as { tasks: any[] } | undefined;
      const author = req.author as string ?? "user";
      if (!teamId || !planId || !revision?.tasks) {
        return { ok: false, error: "Missing required: teamId, planId, revision.tasks" };
      }
      const plan = tm.revisePlan(teamId, planId, author, revision.tasks);
      if (!plan) return { ok: false, error: `Plan ${planId} not found` };
      return { ok: true, teamPlan: plan };
    }

    case "team.plan.get": {
      const teamId = req.teamId as string | undefined;
      const planId = req.planId as string | undefined;
      if (!teamId || !planId) {
        return { ok: false, error: "Missing required: teamId, planId" };
      }
      const plan = tm.getPlan(teamId, planId);
      if (!plan) return { ok: false, error: `Plan ${planId} not found` };
      return { ok: true, teamPlan: plan };
    }

    case "team.plan.latest": {
      const teamId = req.teamId as string | undefined;
      if (!teamId) {
        return { ok: false, error: "Missing required: teamId" };
      }
      const plan = tm.getLatestPlan(teamId);
      if (!plan) return { ok: true, teamPlan: undefined };
      return { ok: true, teamPlan: plan };
    }

    case "team.plan.delete": {
      const teamId = req.teamId as string | undefined;
      const planId = req.planId as string | undefined;
      if (!teamId || !planId) {
        return { ok: false, error: "Missing required: teamId, planId" };
      }
      const deleted = tm.deletePlan(teamId, planId);
      if (!deleted) return { ok: false, error: `Plan ${planId} not found` };
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown command: ${req.cmd}` };
  }
}

// ── Claude CLI helpers ──

function spawnClaude(
  args: string[],
  cwd?: string,
  timeoutMs = 15000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
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

    const child = child_process.spawn("claude", args, {
      cwd: cwd ?? home,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: [...extraDirs, currentPath].join(":"),
      },
    });
    child.stdin?.end();

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude command timed out"));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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
