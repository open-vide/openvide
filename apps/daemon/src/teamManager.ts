/**
 * Team Manager — orchestrates agent teams, task boards, messaging, and plan review.
 *
 * Storage layout:
 *   ~/.openvide-daemon/teams/{teamId}/
 *     config.json          — TeamConfig
 *     tasks/{taskId}.json  — TeamTask
 *     messages.jsonl       — one TeamMessage per line
 *     plans/{planId}.json  — TeamPlan
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { daemonDir, newId, nowISO, log, logError } from "./utils.js";
import * as sm from "./sessionManager.js";
import type {
  TeamConfig, TeamMember, TeamTask, TaskStatus, TaskComment,
  TeamMessage, TeamPlan, PlanRevision, PlanReviewVote, PlanMode,
  Tool, IpcResponse,
} from "./types.js";

const TEAMS_DIR = path.join(daemonDir(), "teams");

// Broadcast listener (registered by bridgeServer)
type BroadcastFn = (event: Record<string, unknown>) => void;
let broadcast: BroadcastFn = () => {};

export function registerTeamBroadcast(fn: BroadcastFn): void {
  broadcast = fn;
}

// ── Helpers ──

function teamDir(teamId: string): string {
  return path.join(TEAMS_DIR, teamId);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch { return null; }
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function appendJsonl(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(data) + "\n");
}

function readJsonl<T>(filePath: string, limit?: number): T[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const parsed = lines.map((l) => JSON.parse(l) as T);
    if (limit && limit > 0) return parsed.slice(-limit);
    return parsed;
  } catch { return []; }
}

// ── Team CRUD ──

export function createTeam(
  name: string,
  workingDirectory: string,
  members: Array<{ name: string; tool: Tool; model?: string; role: string }>,
): TeamConfig {
  const teamId = newId("team");
  const now = nowISO();

  // Create a daemon session for each member
  const resolvedMembers: TeamMember[] = members.map((m) => {
    const session = sm.createSession(
      m.tool,
      workingDirectory,
      m.model,
      undefined,
      undefined,
      undefined,
      { runKind: "team", teamId, teamName: name },
    );
    return {
      name: m.name,
      tool: m.tool,
      model: m.model,
      role: m.role as TeamMember["role"],
      sessionId: session.id,
    };
  });

  const config: TeamConfig = {
    id: teamId,
    name,
    workingDirectory,
    members: resolvedMembers,
    createdAt: now,
    updatedAt: now,
  };

  writeJson(path.join(teamDir(teamId), "config.json"), config);
  ensureDir(path.join(teamDir(teamId), "tasks"));
  ensureDir(path.join(teamDir(teamId), "plans"));

  // Persist in daemon state
  const state = sm.getState();
  if (!state.teams) state.teams = {};
  state.teams[teamId] = config;
  sm.persist();

  log(`Created team ${teamId} "${name}" with ${resolvedMembers.length} members`);
  return config;
}

export function updateTeam(
  teamId: string,
  updates: {
    name?: string;
    workingDirectory?: string;
    members?: Array<{ name: string; tool: Tool; model?: string; role: string }>;
  },
): TeamConfig | null {
  const state = sm.getState();
  const current = state.teams?.[teamId];
  if (!current) return null;

  const nextName = updates.name?.trim() || current.name;
  const nextWorkingDirectory = updates.workingDirectory?.trim() || current.workingDirectory;
  const nextMembersInput = (updates.members?.length ? updates.members : current.members)
    .map((member) => ({
      name: member.name.trim(),
      tool: member.tool,
      model: member.model,
      role: member.role,
    }))
    .filter((member) => member.name.length > 0);

  const currentByName = new Map(current.members.map((member) => [member.name, member]));
  const reusedSessionIds = new Set<string>();
  const resolvedMembers: TeamMember[] = nextMembersInput.map((member) => {
    const existing = currentByName.get(member.name);
    if (existing && existing.tool === member.tool && existing.model === member.model) {
      sm.updateSession(existing.sessionId, {
        workingDirectory: nextWorkingDirectory,
        model: member.model,
        runKind: "team",
        teamId,
        teamName: nextName,
      });
      reusedSessionIds.add(existing.sessionId);
      return {
        ...existing,
        role: member.role as TeamMember["role"],
        model: member.model,
      };
    }

    const session = sm.createSession(
      member.tool,
      nextWorkingDirectory,
      member.model,
      undefined,
      undefined,
      undefined,
      { runKind: "team", teamId, teamName: nextName },
    );
    return {
      name: member.name,
      tool: member.tool,
      model: member.model,
      role: member.role as TeamMember["role"],
      sessionId: session.id,
    };
  });

  for (const member of current.members) {
    if (!reusedSessionIds.has(member.sessionId)) {
      sm.removeSession(member.sessionId);
    }
  }

  const nextConfig: TeamConfig = {
    ...current,
    name: nextName,
    workingDirectory: nextWorkingDirectory,
    members: resolvedMembers,
    updatedAt: nowISO(),
  };

  writeJson(path.join(teamDir(teamId), "config.json"), nextConfig);
  state.teams![teamId] = nextConfig;
  sm.persist();

  broadcast({ type: "team_updated", teamId, name: nextName });
  log(`Updated team ${teamId} "${nextName}" with ${resolvedMembers.length} members`);
  return nextConfig;
}

export function listTeams(): TeamConfig[] {
  const state = sm.getState();
  return Object.values(state.teams ?? {});
}

export function getTeam(teamId: string): TeamConfig | undefined {
  return sm.getState().teams?.[teamId];
}

export function deleteTeam(teamId: string): boolean {
  const state = sm.getState();
  const team = state.teams?.[teamId];
  if (!team) return false;

  // Remove member sessions
  for (const member of team.members) {
    sm.removeSession(member.sessionId);
  }

  // Remove team directory
  try {
    fs.rmSync(teamDir(teamId), { recursive: true, force: true });
  } catch { /* ignore */ }

  delete state.teams![teamId];
  sm.persist();

  log(`Deleted team ${teamId}`);
  return true;
}

export function deletePlan(teamId: string, planId: string): boolean {
  const planPath = path.join(teamDir(teamId), "plans", `${planId}.json`);
  if (!fs.existsSync(planPath)) return false;
  fs.rmSync(planPath, { force: true });
  broadcast({ type: "team_plan_deleted", teamId, planId });
  log(`Deleted plan ${planId} from team ${teamId}`);
  return true;
}

// ── Tasks ──

export function createTask(
  teamId: string,
  subject: string,
  description: string,
  owner: string,
  dependencies?: string[],
  opts?: { autoStart?: boolean },
): TeamTask {
  const team = getTeam(teamId);
  if (!team) throw new Error(`Team ${teamId} not found`);

  const taskId = newId("task");
  const now = nowISO();

  const task: TeamTask = {
    id: taskId,
    teamId,
    subject,
    description,
    owner,
    status: "todo",
    dependencies: dependencies ?? [],
    blockedBy: [],
    comments: [],
    createdAt: now,
    updatedAt: now,
  };

  // Calculate blockedBy from dependencies
  if (dependencies && dependencies.length > 0) {
    const allTasks = listTasks(teamId);
    task.blockedBy = dependencies.filter((depId) => {
      const dep = allTasks.find((t) => t.id === depId);
      return dep && dep.status !== "approved" && dep.status !== "done";
    });
  }

  writeJson(path.join(teamDir(teamId), "tasks", `${taskId}.json`), task);

  broadcast({ type: "team_task_updated", teamId, taskId, status: task.status, owner });
  log(`Created task ${taskId} "${subject}" for team ${teamId}`);

  if (opts?.autoStart !== false && owner && task.blockedBy.length === 0) {
    autoStartTask(teamId, task);
  }

  return task;
}

export function listTasks(teamId: string): TeamTask[] {
  const tasksDir = path.join(teamDir(teamId), "tasks");
  try {
    const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".json"));
    return files.map((f) => readJson<TeamTask>(path.join(tasksDir, f))!).filter(Boolean);
  } catch { return []; }
}

export function getTask(teamId: string, taskId: string): TeamTask | null {
  return readJson<TeamTask>(path.join(teamDir(teamId), "tasks", `${taskId}.json`));
}

export function updateTask(
  teamId: string,
  taskId: string,
  updates: { status?: TaskStatus; owner?: string; description?: string },
): TeamTask | null {
  const task = getTask(teamId, taskId);
  if (!task) return null;

  if (updates.status) task.status = updates.status;
  if (updates.owner) task.owner = updates.owner;
  if (updates.description) task.description = updates.description;
  task.updatedAt = nowISO();

  writeJson(path.join(teamDir(teamId), "tasks", `${taskId}.json`), task);

  // Auto-notifications on status change
  if (updates.status) {
    handleTaskStatusChange(teamId, task, updates.status);
  }

  broadcast({ type: "team_task_updated", teamId, taskId, status: task.status, owner: task.owner });
  return task;
}

function handleTaskStatusChange(teamId: string, task: TeamTask, newStatus: TaskStatus): void {
  const team = getTeam(teamId);
  if (!team) return;

  if (newStatus === "done" || newStatus === "review") {
    // Auto-send to reviewer
    const reviewer = team.members.find((m) => m.role === "reviewer");
    if (reviewer) {
      sendTaskToReviewer(team, reviewer, task);
    }
  }

  if (newStatus === "approved") {
    // Check if any blocked tasks are now unblocked
    const allTasks = listTasks(teamId);
    for (const other of allTasks) {
      if (other.blockedBy.includes(task.id)) {
        other.blockedBy = other.blockedBy.filter((id) => id !== task.id);
        writeJson(path.join(teamDir(teamId), "tasks", `${other.id}.json`), other);

        // If fully unblocked and still todo, auto-start
        if (other.blockedBy.length === 0 && other.status === "todo") {
          autoStartTask(teamId, other);
        }
      }
    }
  }
}

function autoStartTask(teamId: string, task: TeamTask): void {
  const team = getTeam(teamId);
  if (!team) return;

  const member = team.members.find((m) => m.name === task.owner);
  if (!member) return;

  task.status = "in_progress";
  task.updatedAt = nowISO();
  writeJson(path.join(teamDir(teamId), "tasks", `${task.id}.json`), task);

  const prompt = [
    `You are ${member.name}, working as ${member.role} on team "${team.name}".`,
    `Execute this task autonomously in ${team.workingDirectory}.`,
    getRoleExecutionGuidance(member.role),
    "",
    `Task: ${task.subject}`,
    task.description ? `Description:\n${task.description}` : "Description:\nNo extra description provided.",
    "",
    "When you are done, end your final response with:",
    "TASK_STATUS: DONE",
    "SUMMARY:",
    "- short outcome bullet(s)",
  ].join("\n");

  try {
    const res = sm.sendTurn(member.sessionId, prompt);
    if (!res.ok) {
      throw new Error(res.error ?? `Failed to start task ${task.id}`);
    }
    watchSessionResponse(member.sessionId, (result) => {
      const latest = getTask(teamId, task.id);
      if (!latest) return;

      if (result.status !== "idle") {
        const failure = (result.errorText ?? result.responseText).trim() || `${member.name} failed to complete ${latest.subject}.`;
        addComment(teamId, latest.id, member.name, failure.slice(0, 2000));
        writeTeamMessage(teamId, {
          from: member.name,
          to: "team",
          text: `Task failed: ${failure}`.slice(0, 2000),
        });
        updateTask(teamId, latest.id, { status: "todo" });
        return;
      }

      const summary = result.responseText.trim() || `${member.name} completed ${latest.subject}.`;
      addComment(teamId, latest.id, member.name, summary.slice(0, 2000));
      writeTeamMessage(teamId, {
        from: member.name,
        to: "team",
        text: summary.slice(0, 2000),
      });
      updateTask(teamId, latest.id, { status: "review" });
    });
  } catch (err) {
    log(`[team] Failed to start task for ${member.name}: ${err instanceof Error ? err.message : String(err)}`);
  }

  broadcast({ type: "team_task_updated", teamId, taskId: task.id, status: "in_progress", owner: task.owner });
  broadcast({ type: "team_agent_status", teamId, agentName: member.name, status: "started" });
  log(`Auto-started task ${task.id} for ${member.name}`);
}

function sendTaskToReviewer(team: TeamConfig, reviewer: TeamMember, task: TeamTask): void {
  const prompt = [
    `You are reviewing task ${task.id} for team "${team.name}".`,
    "",
    `Task: ${task.subject}`,
    task.description ? `Description:\n${task.description}` : "Description:\nNo extra description provided.",
    "",
    `Completed by: ${task.owner || "unassigned"}`,
    "",
    "Respond using this exact footer:",
    "REVIEW_DECISION: APPROVE | REVISE | REJECT",
    "FEEDBACK:",
    "- short reason(s)",
  ].join("\n");

  try {
    const result = sm.sendTurn(reviewer.sessionId, prompt);
    if (!result.ok) throw new Error(result.error ?? `Failed to send review for ${task.id}`);
    watchSessionResponse(reviewer.sessionId, (result) => {
      const latest = getTask(team.id, task.id);
      if (!latest) return;

      if (result.status !== "idle") {
        const failure = (result.errorText ?? result.responseText).trim() || `Review failed for ${latest.subject}.`;
        addComment(team.id, latest.id, reviewer.name, failure.slice(0, 2000));
        writeTeamMessage(team.id, {
          from: reviewer.name,
          to: latest.owner || "team",
          text: `REVIEW FAILED ${latest.subject} — ${failure}`.slice(0, 2000),
        });
        return;
      }

      const parsed = parseStructuredDecision(result.responseText, "REVIEW_DECISION");
      const feedback = parsed?.feedback ?? result.responseText.trim();
      if (feedback) {
        addComment(team.id, latest.id, reviewer.name, feedback.slice(0, 2000));
      }
      writeTeamMessage(team.id, {
        from: reviewer.name,
        to: latest.owner || "team",
        text: `${parsed?.decision?.toUpperCase() ?? "REVIEW"} ${latest.subject}${feedback ? ` — ${feedback}` : ""}`.slice(0, 2000),
      });

      if (!parsed || parsed.decision === "revise" || parsed.decision === "reject") {
        updateTask(team.id, latest.id, { status: "in_progress" });
        return;
      }

      updateTask(team.id, latest.id, { status: "approved" });
    });
    log(`Auto-sent review request to ${reviewer.name} for task ${task.id}`);
  } catch (err) {
    log(`[team] Failed to send review to ${reviewer.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function addComment(teamId: string, taskId: string, author: string, text: string): TaskComment | null {
  const task = getTask(teamId, taskId);
  if (!task) return null;

  const comment: TaskComment = {
    id: newId("cmt"),
    author,
    text,
    createdAt: nowISO(),
  };

  task.comments.push(comment);
  task.updatedAt = nowISO();
  writeJson(path.join(teamDir(teamId), "tasks", `${taskId}.json`), task);

  return comment;
}

// ── Messaging ──

function writeTeamMessage(
  teamId: string,
  input: { from: string; to: string; text: string; fromTool?: Tool },
): TeamMessage {
  const team = getTeam(teamId);
  const memberTool = team?.members.find((member) => member.name === input.from)?.tool;
  const msg: TeamMessage = {
    id: newId("msg"),
    teamId,
    from: input.from,
    fromTool: input.fromTool ?? memberTool,
    to: input.to,
    text: input.text,
    createdAt: nowISO(),
  };
  appendJsonl(path.join(teamDir(teamId), "messages.jsonl"), msg);
  broadcast({ type: "team_message", teamId, messageId: msg.id, from: msg.from, fromTool: msg.fromTool, to: msg.to, text: msg.text });
  return msg;
}

function getCoordinator(team: TeamConfig): TeamMember | undefined {
  return team.members.find((member) => member.role === "planner")
    ?? team.members.find((member) => member.role === "lead")
    ?? team.members[0];
}

function getPrimaryCoder(team: TeamConfig): TeamMember | undefined {
  return team.members.find((member) => member.role === "coder");
}

function getPrimaryReviewer(team: TeamConfig): TeamMember | undefined {
  return team.members.find((member) => member.role === "reviewer");
}

function getRoleExecutionGuidance(role: TeamMember["role"]): string {
  switch (role) {
    case "coder":
      return "You are the implementation owner. Create or modify the required files yourself and deliver the concrete artifact.";
    case "reviewer":
      return "You are the reviewer/validator. Review, verify, and report issues. Do not take over the main implementation unless the task explicitly says so.";
    case "planner":
      return "You are the planner. Break down work, coordinate next steps, and only implement directly if the task explicitly requires planning artifacts.";
    case "lead":
      return "You are the lead. Coordinate, unblock, and provide final sign-off. Do not take over hands-on implementation unless the task explicitly requires it.";
    default:
      return "";
  }
}

function summarizePlanForChat(teamId: string, memberName: string): string {
  const plan = getLatestPlan(teamId);
  if (!plan) {
    return "Latest plan: none.";
  }

  const revision = plan.revisions[plan.revisions.length - 1];
  const taskLines = (revision?.tasks ?? [])
    .slice(0, 8)
    .map((task, index) => {
      const ownerNote = task.owner === memberName ? " [you]" : "";
      const deps = task.dependencies?.length ? ` | depends on ${task.dependencies.join(", ")}` : "";
      return `${index + 1}. ${task.subject} — ${task.owner}${ownerNote}${deps}\n   ${task.description}`;
    })
    .join("\n");

  const voteLines = plan.votes
    .filter((vote) => vote.iteration === plan.iteration)
    .slice(-4)
    .map((vote) => `- ${vote.reviewer}: ${vote.vote.toUpperCase()}${vote.feedback ? ` — ${vote.feedback}` : ""}`)
    .join("\n");

  return [
    `Latest plan: ${plan.id} (${plan.status}, ${plan.mode}, iteration ${plan.iteration}/${plan.maxIterations})`,
    taskLines ? `Plan tasks:\n${taskLines}` : "Plan tasks: none.",
    voteLines ? `Current iteration votes:\n${voteLines}` : "",
  ].filter(Boolean).join("\n");
}

function summarizeBoardForChat(teamId: string, memberName: string): string {
  const tasks = listTasks(teamId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 8);

  if (tasks.length === 0) {
    return "Board: no tasks yet.";
  }

  return [
    "Current board:",
    ...tasks.map((task) => {
      const ownerNote = task.owner === memberName ? " [you]" : "";
      const blockers = task.blockedBy.length ? ` | blocked by ${task.blockedBy.length}` : "";
      return `- [${task.status}] ${task.subject} — ${task.owner}${ownerNote}${blockers}`;
    }),
  ].join("\n");
}

function buildChatPrompt(team: TeamConfig, member: TeamMember, from: string, to: string, text: string): string {
  const directMessage = to !== "*" && to === member.name;
  const coordinatorMessage = to === "*" && getCoordinator(team)?.name === member.name;

  const extraGuidance = [
    member.role === "reviewer"
      ? "If the user refers to \"this plan\" or \"the plan\", assume they mean the latest team plan summarized below unless they specify otherwise."
      : "",
    coordinatorMessage
      ? "You are handling a team-level request. Coordinate using the latest plan and board context below. Delegate by role rather than taking over implementation yourself unless implementation is explicitly assigned to you."
      : "",
    directMessage && member.role === "coder"
      ? "If the request is asking for implementation or file creation, treat yourself as the hands-on owner unless the latest plan clearly assigns that work to someone else."
      : "",
    "Use the team context below. Do not ask the user to paste information that is already included here.",
  ].filter(Boolean).join("\n");

  return [
    `You are ${member.name}, the ${member.role} for team "${team.name}" working in ${team.workingDirectory}.`,
    getRoleExecutionGuidance(member.role),
    extraGuidance,
    "",
    `Incoming team chat message from ${from}${to === "*" ? " to the team" : ` to ${to}`}:`,
    text,
    "",
    summarizePlanForChat(team.id, member.name),
    "",
    summarizeBoardForChat(team.id, member.name),
    "",
    "Reply in your role with the concrete next step, answer, review, or implementation summary that best moves the team forward.",
  ].join("\n");
}

function extractLastTurnResult(sessionId: string): { responseText: string; errorText?: string } {
  const outputPath = path.join(daemonDir(), "sessions", sessionId, "output.jsonl");
  const content = fs.readFileSync(outputPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  let responseText = "";
  let errorText = "";
  let hasTerminalResult = false;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const entry = JSON.parse(lines[i]!);
      if (entry.t === "m" && entry.event === "turn_end") continue;
      if (entry.t === "m" && entry.event === "turn_start") break;
      if ((entry.t !== "o" && entry.t !== "e") || !entry.line) continue;

      try {
        const parsed = JSON.parse(entry.line);
        if (parsed.type === "result" && typeof parsed.result === "string") {
          if (parsed.is_error === true || parsed.subtype === "error") {
            errorText = parsed.result.trim() || errorText;
          } else if (!responseText) {
            responseText = parsed.result.trim();
          }
          hasTerminalResult = true;
          continue;
        }

        if (hasTerminalResult) {
          continue;
        }

        if (parsed.type === "assistant" && Array.isArray(parsed.message?.content)) {
          const assistantText = parsed.message.content
            .map((part: unknown) => {
              if (
                !part
                || typeof part !== "object"
                || (part as { type?: unknown }).type !== "text"
                || typeof (part as { text?: unknown }).text !== "string"
              ) {
                return "";
              }
              return (part as { text: string }).text.trim();
            })
            .filter(Boolean)
            .join("\n");
          if (assistantText) {
            responseText = assistantText + (responseText ? "\n" + responseText : "");
          }
        }

        if (parsed.type === "content_block" && parsed.block?.type === "text" && parsed.block.text) {
          responseText = parsed.block.text + (responseText ? "\n" + responseText : "");
        }
        if (
          parsed.type === "item.completed"
          && parsed.item?.type === "agent_message"
          && typeof parsed.item.text === "string"
          && parsed.item.text.trim().length > 0
        ) {
          responseText = parsed.item.text.trim() + (responseText ? "\n" + responseText : "");
        }
        if (!errorText && parsed.type === "error" && typeof parsed.message === "string") {
          errorText = parsed.message;
        }
        if (!errorText && parsed.type === "turn.failed" && typeof parsed.error?.message === "string") {
          errorText = parsed.error.message;
        }
      } catch {
        if (entry.t === "e") {
          errorText = entry.line + (errorText ? "\n" + errorText : "");
        } else if (!entry.line.startsWith("{")) {
          responseText = entry.line + (responseText ? "\n" + responseText : "");
        }
      }
    } catch {
      // Skip malformed lines.
    }
  }

  return {
    responseText: responseText.trim(),
    errorText: errorText.trim() || undefined,
  };
}

export function sendMessage(teamId: string, from: string, to: string, text: string): TeamMessage {
  const team = getTeam(teamId);
  if (!team) throw new Error(`Team ${teamId} not found`);

  const msg = writeTeamMessage(teamId, { from, to, text });

  // Team-level user messages go to the coordinator instead of blindly fanning out.
  if (to === "*") {
    if (from === "user") {
      const coordinator = getCoordinator(team);
      if (coordinator) {
        injectMessage(coordinator, from, to, text, teamId);
        return msg;
      }
    }
    for (const member of team.members) {
      if (member.name !== from) {
        injectMessage(member, from, to, text, teamId);
      }
    }
  } else {
    const target = team.members.find((m) => m.name === to);
    if (target) {
      injectMessage(target, from, to, text, teamId);
    }
  }

  return msg;
}

function injectMessage(member: TeamMember, from: string, to: string, text: string, teamId: string): void {
  const team = getTeam(teamId);
  if (!team) return;
  const session = sm.getSession(member.sessionId);
  if (session && session.status === "idle") {
    try {
      const prompt = buildChatPrompt(team, member, from, to, text);
      const result = sm.sendTurn(member.sessionId, prompt);
      if (result.ok) {
        watchSessionResponse(member.sessionId, (completion) => {
          const output = (completion.status === "idle" ? completion.responseText : completion.errorText ?? completion.responseText).trim();
          if (!output) return;
          writeTeamMessage(teamId, {
            from: member.name,
            to: "user",
            text: output.slice(0, 2000),
          });
          log(`[team] Captured response from ${member.name} (${output.length} chars)`);
        });
      }
    } catch (err) {
      log(`[team] Failed to inject message to ${member.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

type SessionCompletion = {
  status: "idle" | "failed" | "cancelled" | "interrupted";
  responseText: string;
  errorText?: string;
};

const activeWatchers = new Map<string, (result: SessionCompletion) => void>();

/** Poll a session until it goes idle, then capture the last turn response. */
function watchSessionResponse(sessionId: string, onComplete: (result: SessionCompletion) => void): void {
  if (activeWatchers.has(sessionId)) return;
  activeWatchers.set(sessionId, onComplete);

  const pollMs = 2000;
  const maxPolls = 150; // 5 minutes max
  let polls = 0;

  const interval = setInterval(() => {
    polls++;
    const session = sm.getSession(sessionId);
    if (!session || polls >= maxPolls) {
      clearInterval(interval);
      activeWatchers.delete(sessionId);
      return;
    }

    if (session.status !== "running") {
      clearInterval(interval);
      const handler = activeWatchers.get(sessionId);
      activeWatchers.delete(sessionId);

      try {
        const result = extractLastTurnResult(sessionId);
        handler?.({
          status: session.status === "idle" || session.status === "failed" || session.status === "cancelled" || session.status === "interrupted"
            ? session.status
            : "failed",
          responseText: result.responseText,
          errorText: result.errorText,
        });
      } catch (err) {
        log(`[team] Failed to capture response for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, pollMs);
}

// daemonDir imported from utils.js

export function listMessages(teamId: string, limit?: number): TeamMessage[] {
  return readJsonl<TeamMessage>(path.join(teamDir(teamId), "messages.jsonl"), limit);
}

// ── Plans ──

export function listPlans(teamId: string): TeamPlan[] {
  const plansDir = path.join(teamDir(teamId), "plans");
  try {
    const files = fs.readdirSync(plansDir).filter((f) => f.endsWith(".json"));
    return files
      .map((file) => readJson<TeamPlan>(path.join(plansDir, file))!)
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function getLatestPlan(teamId: string): TeamPlan | null {
  return listPlans(teamId)[0] ?? null;
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  throw new Error("No JSON object found");
}

function parsePlanTasksFromResponse(team: TeamConfig, responseText: string): PlanRevision["tasks"] {
  const parsed = JSON.parse(extractJsonObject(responseText)) as { tasks?: Array<Record<string, unknown>> };
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error("Planner response did not include tasks");
  }

  const fallbackOwner = team.members.find((member) => member.role === "coder")
    ?.name
    ?? team.members.find((member) => member.role === "planner" || member.role === "lead")
      ?.name
    ?? team.members[0]?.name
    ?? "unassigned";
  const memberNames = new Set(team.members.map((member) => member.name));

  return parsed.tasks.map((task, index) => {
    const subject = typeof task.subject === "string" && task.subject.trim().length > 0
      ? task.subject.trim()
      : `Task ${index + 1}`;
    const description = typeof task.description === "string" ? task.description.trim() : "";
    const ownerCandidate = typeof task.owner === "string" ? task.owner.trim() : fallbackOwner;
    const owner = memberNames.has(ownerCandidate) ? ownerCandidate : fallbackOwner;
    const dependencies = Array.isArray(task.dependencies)
      ? task.dependencies.map((dep) => String(dep))
      : undefined;
    return { subject, description, owner, dependencies };
  });
}

function parseStructuredDecision(
  responseText: string,
  marker: string,
): { decision: "approve" | "revise" | "reject"; feedback?: string } | null {
  const match = responseText.match(new RegExp(`${marker}:\\s*(APPROVE|REVISE|REJECT)`, "i"));
  if (!match) return null;
  const decision = match[1]!.toLowerCase() as "approve" | "revise" | "reject";
  const feedbackMatch = responseText.match(/FEEDBACK:\s*([\s\S]*)$/i);
  const feedback = feedbackMatch?.[1]?.trim();
  return { decision, feedback: feedback && feedback.length > 0 ? feedback : undefined };
}

function buildPlanGenerationPrompt(team: TeamConfig, request: string): string {
  const roster = team.members
    .map((member) => `- ${member.name} (${member.role}, ${member.tool}${member.model ? `, ${member.model}` : ""})`)
    .join("\n");
  const coder = getPrimaryCoder(team)?.name ?? "none";
  const reviewer = getPrimaryReviewer(team)?.name ?? "none";
  const coordinator = getCoordinator(team)?.name ?? "none";

  return `You are planning work for team "${team.name}" in ${team.workingDirectory}.

Team roster:
${roster}

Role rules:
- Coordinator/lead/planner: ${coordinator}
- Primary coder: ${coder}
- Primary reviewer: ${reviewer}
- Implementation, coding, writing, and file modification tasks should go to the coder whenever a coder exists.
- Reviewer tasks should be review, QA, validation, or sign-off only.
- Lead/planner tasks should be planning, coordination, clarification, or final sign-off only.
- Do not assign the same concrete implementation deliverable to multiple members unless the user explicitly asks for parallel implementations.
- If the request is to implement or write a file, the coder should own the writing/modification task and the reviewer should own verification.

User request:
${request}

Respond with ONLY valid JSON in this shape:
{
  "tasks": [
    {
      "subject": "short title",
      "description": "what the owner should do",
      "owner": "exact team member name",
      "dependencies": ["0"]
    }
  ]
}

Rules:
- Use exact member names from the roster.
- dependencies should reference earlier task indexes as strings.
- Keep task descriptions concrete and actionable.
- Do not include markdown or explanation outside the JSON.`;
}

export function generatePlan(
  teamId: string,
  request: string,
  opts?: { mode?: PlanMode; reviewers?: string[]; maxIterations?: number },
): boolean {
  const team = getTeam(teamId);
  if (!team) throw new Error(`Team ${teamId} not found`);

  const planner = team.members.find((member) => member.role === "planner")
    ?? team.members.find((member) => member.role === "lead")
    ?? team.members[0];
  if (!planner) throw new Error(`Team ${teamId} has no members`);

  writeTeamMessage(teamId, {
    from: "user",
    to: planner.name,
    text: request,
  });

  const result = sm.sendTurn(planner.sessionId, buildPlanGenerationPrompt(team, request));
  if (!result.ok) {
    throw new Error(result.error ?? `Failed to generate plan for ${teamId}`);
  }

  watchSessionResponse(planner.sessionId, (result) => {
    if (result.status !== "idle") {
      writeTeamMessage(teamId, {
        from: planner.name,
        to: "team",
        text: `Plan generation failed: ${((result.errorText ?? result.responseText) || "Unknown error").slice(0, 2000)}`,
      });
      return;
    }
    try {
      const tasks = parsePlanTasksFromResponse(team, result.responseText);
      const plan = submitPlan(teamId, tasks, planner.name, opts);
      writeTeamMessage(teamId, {
        from: planner.name,
        to: "team",
        text: `Generated plan ${plan.id} with ${tasks.length} task${tasks.length !== 1 ? "s" : ""}.`,
      });
    } catch (err) {
      writeTeamMessage(teamId, {
        from: planner.name,
        to: "team",
        text: `Plan generation failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 2000),
      });
    }
  });

  log(`Plan generation requested for team ${teamId} via ${planner.name}`);
  return true;
}

export function submitPlan(
  teamId: string,
  tasks: PlanRevision["tasks"],
  createdBy: string,
  opts?: { mode?: PlanMode; reviewers?: string[]; maxIterations?: number },
): TeamPlan {
  const team = getTeam(teamId);
  if (!team) throw new Error(`Team ${teamId} not found`);

  const planId = newId("plan");
  const now = nowISO();
  const mode = opts?.mode ?? "simple";
  const reviewers = opts?.reviewers ?? team.members.filter((m) => m.role === "reviewer").map((m) => m.name);
  const maxIterations = opts?.maxIterations ?? 5;

  const revision: PlanRevision = {
    id: newId("rev"),
    author: createdBy,
    tasks,
    createdAt: now,
  };

  const plan: TeamPlan = {
    id: planId,
    teamId,
    revisions: [revision],
    votes: [],
    status: "review",
    mode,
    createdBy,
    reviewers,
    currentReviewer: mode === "simple" ? reviewers[0] : undefined,
    iteration: 1,
    maxIterations,
    createdAt: now,
    updatedAt: now,
  };

  writeJson(path.join(teamDir(teamId), "plans", `${planId}.json`), plan);

  // Send to reviewers
  const reviewPrompt = buildReviewPrompt(plan, revision);
  if (mode === "simple") {
    sendToReviewer(team, reviewers[0], reviewPrompt);
  } else {
    // Consensus: send to all reviewers
    for (const reviewer of reviewers) {
      sendToReviewer(team, reviewer, reviewPrompt);
    }
  }

  broadcast({ type: "team_plan_updated", teamId, planId, status: "review", iteration: 1 });
  log(`Plan ${planId} submitted for team ${teamId} (mode: ${mode}, reviewers: ${reviewers.join(", ")})`);
  return plan;
}

export function reviewPlan(
  teamId: string,
  planId: string,
  reviewer: string,
  vote: "approve" | "revise" | "reject",
  feedback?: string,
): TeamPlan | null {
  const plan = getPlan(teamId, planId);
  if (!plan) return null;
  const team = getTeam(teamId);
  if (!team) return null;

  // Record vote
  const voteRecord: PlanReviewVote = {
    reviewer,
    vote,
    feedback,
    iteration: plan.iteration,
    createdAt: nowISO(),
  };
  plan.votes.push(voteRecord);
  plan.updatedAt = nowISO();

  broadcast({ type: "team_plan_vote", teamId, planId, reviewer, vote });

  if (plan.mode === "simple") {
    handleSimpleReview(team, plan, vote, feedback);
  } else {
    handleConsensusReview(team, plan);
  }

  writeJson(path.join(teamDir(teamId), "plans", `${planId}.json`), plan);
  broadcast({ type: "team_plan_updated", teamId, planId, status: plan.status, iteration: plan.iteration });
  return plan;
}

function handleSimpleReview(team: TeamConfig, plan: TeamPlan, vote: string, feedback?: string): void {
  if (vote === "approve") {
    const currentIdx = plan.reviewers.indexOf(plan.currentReviewer ?? "");
    if (currentIdx < plan.reviewers.length - 1) {
      // Send to next reviewer
      plan.currentReviewer = plan.reviewers[currentIdx + 1];
      const revision = plan.revisions[plan.revisions.length - 1]!;
      sendToReviewer(team, plan.currentReviewer, buildReviewPrompt(plan, revision));
    } else {
      // All reviewers approved
      approvePlan(team, plan);
    }
  } else if (vote === "revise") {
    plan.status = "revision";
    sendRevisionRequest(team, plan, [{ reviewer: plan.currentReviewer ?? "reviewer", feedback: feedback ?? "" }]);
  } else {
    plan.status = "rejected";
    log(`Plan ${plan.id} rejected`);
  }
}

function handleConsensusReview(team: TeamConfig, plan: TeamPlan): void {
  // Check if all reviewers have voted for current iteration
  const currentVotes = plan.votes.filter((v) => v.iteration === plan.iteration);
  if (currentVotes.length < plan.reviewers.length) return; // Wait for more votes

  const allApprove = currentVotes.every((v) => v.vote === "approve");
  const anyReject = currentVotes.some((v) => v.vote === "reject");
  const reviseVotes = currentVotes.filter((v) => v.vote === "revise");

  if (allApprove) {
    approvePlan(team, plan);
  } else if (anyReject) {
    plan.status = "rejected";
    log(`Plan ${plan.id} rejected by consensus`);
  } else if (reviseVotes.length > 0) {
    if (plan.iteration >= plan.maxIterations) {
      // Max iterations reached — auto-approve with latest revision
      plan.status = "auto-approved";
      log(`Plan ${plan.id} auto-approved after ${plan.iteration} iterations`);
      autoCreateTasks(team, plan);
    } else {
      plan.status = "revision";
      const feedbacks = reviseVotes.map((v) => ({ reviewer: v.reviewer, feedback: v.feedback ?? "" }));
      sendRevisionRequest(team, plan, feedbacks);
    }
  }
}

function approvePlan(team: TeamConfig, plan: TeamPlan): void {
  plan.status = "approved";
  log(`Plan ${plan.id} approved`);
  autoCreateTasks(team, plan);
}

function autoCreateTasks(team: TeamConfig, plan: TeamPlan): void {
  const latestRevision = plan.revisions[plan.revisions.length - 1];
  if (!latestRevision) return;

  const taskIdMap = new Map<string, string>(); // plan task index → real task ID

  // First pass: create all tasks
  for (let i = 0; i < latestRevision.tasks.length; i++) {
    const pt = latestRevision.tasks[i];
    const task = createTask(team.id, pt.subject, pt.description, pt.owner, undefined, { autoStart: false });
    taskIdMap.set(String(i), task.id);
  }

  // Second pass: wire dependencies and auto-start unblocked
  for (let i = 0; i < latestRevision.tasks.length; i++) {
    const pt = latestRevision.tasks[i];
    if (pt.dependencies && pt.dependencies.length > 0) {
      const taskId = taskIdMap.get(String(i))!;
      const task = getTask(team.id, taskId);
      if (task) {
        task.dependencies = pt.dependencies.map((d) => taskIdMap.get(d) ?? d);
        task.blockedBy = task.dependencies.filter((depId) => {
          const dep = getTask(team.id, depId);
          return dep && dep.status !== "approved" && dep.status !== "done";
        });
        writeJson(path.join(teamDir(team.id), "tasks", `${taskId}.json`), task);
      }
    }
  }

  // Auto-start unblocked tasks
  const allTasks = listTasks(team.id);
  for (const task of allTasks) {
    if (task.status === "todo" && task.blockedBy.length === 0) {
      autoStartTask(team.id, task);
    }
  }
}

export function revisePlan(
  teamId: string,
  planId: string,
  author: string,
  tasks: PlanRevision["tasks"],
): TeamPlan | null {
  const plan = getPlan(teamId, planId);
  if (!plan) return null;
  const team = getTeam(teamId);
  if (!team) return null;

  const revision: PlanRevision = {
    id: newId("rev"),
    author,
    tasks,
    createdAt: nowISO(),
  };

  plan.revisions.push(revision);
  plan.iteration++;
  plan.status = "review";
  plan.updatedAt = nowISO();

  writeJson(path.join(teamDir(teamId), "plans", `${planId}.json`), plan);

  // Send to reviewers
  const prompt = buildReviewPrompt(plan, revision);
  if (plan.mode === "simple") {
    sendToReviewer(team, plan.currentReviewer ?? plan.reviewers[0], prompt);
  } else {
    for (const reviewer of plan.reviewers) {
      sendToReviewer(team, reviewer, prompt);
    }
  }

  broadcast({ type: "team_plan_updated", teamId, planId, status: "review", iteration: plan.iteration });
  return plan;
}

export function getPlan(teamId: string, planId: string): TeamPlan | null {
  return readJson<TeamPlan>(path.join(teamDir(teamId), "plans", `${planId}.json`));
}

// ── Prompt Builders ──

function buildReviewPrompt(plan: TeamPlan, revision: PlanRevision): string {
  const taskList = revision.tasks.map((t, i) =>
    `${i + 1}. ${t.subject} — assigned to ${t.owner}\n   ${t.description}${t.dependencies?.length ? `\n   depends on: ${t.dependencies.join(", ")}` : ""}`
  ).join("\n");

  const modeNote = plan.mode === "consensus"
    ? "\nOther reviewers are also evaluating this plan. All must agree for approval."
    : "";

  const feedbackNote = revision.feedback
    ? `\nPrevious feedback that was addressed:\n${revision.feedback}`
    : "";

  return `Review this plan (iteration ${plan.iteration}/${plan.maxIterations}):

Tasks:
${taskList}
${modeNote}${feedbackNote}

Respond using this exact footer:
PLAN_DECISION: APPROVE | REVISE | REJECT
FEEDBACK:
- short reason(s)`;
}

function sendToReviewer(team: TeamConfig, reviewerName: string, prompt: string): void {
  const member = team.members.find((m) => m.name === reviewerName);
  if (member) {
    try {
      const result = sm.sendTurn(member.sessionId, prompt);
      if (!result.ok) throw new Error(result.error ?? `Failed to send to ${reviewerName}`);
      watchSessionResponse(member.sessionId, (result) => {
        const latestPlan = getLatestPlan(team.id);
        if (!latestPlan || latestPlan.status !== "review") return;
        if (result.status !== "idle") {
          writeTeamMessage(team.id, {
            from: reviewerName,
            to: "team",
            text: `Plan review failed for ${latestPlan.id}: ${((result.errorText ?? result.responseText) || "Unknown error").slice(0, 2000)}`,
          });
          return;
        }
        const decision = parseStructuredDecision(result.responseText, "PLAN_DECISION");
        if (!decision) {
          writeTeamMessage(team.id, {
            from: reviewerName,
            to: "team",
            text: `Unable to parse review decision for plan ${latestPlan.id}.`,
          });
          return;
        }
        writeTeamMessage(team.id, {
          from: reviewerName,
          to: "team",
          text: `${decision.decision.toUpperCase()} ${latestPlan.id}${decision.feedback ? ` — ${decision.feedback}` : ""}`.slice(0, 2000),
        });
        reviewPlan(team.id, latestPlan.id, reviewerName, decision.decision, decision.feedback);
      });
    } catch {
      log(`[team] Failed to send to reviewer ${reviewerName}`);
    }
    log(`Sent review prompt to ${reviewerName}`);
  }
}

function sendRevisionRequest(
  team: TeamConfig,
  plan: TeamPlan,
  feedbacks: Array<{ reviewer: string; feedback: string }>,
): void {
  const planner = team.members.find((m) => m.name === plan.createdBy)
    ?? team.members.find((m) => m.role === "planner")
    ?? team.members.find((m) => m.role === "lead");
  if (!planner) return;

  const feedbackList = feedbacks.map((f) => `- ${f.reviewer}: ${f.feedback}`).join("\n");
  const prompt = `Plan revision requested (iteration ${plan.iteration}/${plan.maxIterations}).

Feedback from reviewers:
${feedbackList}

Please submit a revised plan addressing this feedback.`;

  try {
    const result = sm.sendTurn(planner.sessionId, prompt);
    if (!result.ok) throw new Error(result.error ?? `Failed to send revision request to ${planner.name}`);
    watchSessionResponse(planner.sessionId, (result) => {
      if (result.status !== "idle") {
        writeTeamMessage(team.id, {
          from: planner.name,
          to: "team",
          text: `Revision for ${plan.id} failed: ${((result.errorText ?? result.responseText) || "Unknown error").slice(0, 2000)}`,
        });
        return;
      }
      try {
        const tasks = parsePlanTasksFromResponse(team, result.responseText);
        revisePlan(team.id, plan.id, planner.name, tasks);
        writeTeamMessage(team.id, {
          from: planner.name,
          to: "team",
          text: `Submitted revision for ${plan.id} with ${tasks.length} task${tasks.length !== 1 ? "s" : ""}.`,
        });
      } catch (err) {
        writeTeamMessage(team.id, {
          from: planner.name,
          to: "team",
          text: `Revision for ${plan.id} could not be parsed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 2000),
        });
      }
    });
  } catch {
    log(`[team] Failed to send to planner ${planner.name}`);
  }
  log(`Sent revision request to ${planner.name}`);
}
