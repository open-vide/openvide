import * as path from "node:path";
import { newId, nowISO, log, logError } from "./utils.js";
import * as sm from "./sessionManager.js";
import * as tm from "./teamManager.js";
import type { ScheduledTask, ScheduleTarget, SessionRecord, Tool } from "./types.js";

const TICK_MS = 15_000;
const MAX_NEXT_RUN_LOOKAHEAD_MINUTES = 366 * 24 * 60;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
const runningScheduleIds = new Set<string>();

interface CronField {
  any: boolean;
  values: Set<number>;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  weekday: CronField;
}

export interface CreateScheduleInput {
  name: string;
  schedule: string;
  project?: string;
  enabled?: boolean;
  target: ScheduleTarget;
}

export interface UpdateScheduleInput {
  name?: string;
  schedule?: string;
  project?: string;
  enabled?: boolean;
  target?: ScheduleTarget;
}

function schedulesMap(): Record<string, ScheduledTask> {
  const state = sm.getState();
  if (!state.schedules) state.schedules = {};
  return state.schedules;
}

function normalizeSchedule(record: ScheduledTask): ScheduledTask {
  const now = nowISO();
  const next: ScheduledTask = {
    ...record,
    enabled: record.enabled ?? true,
    createdAt: record.createdAt ?? now,
    updatedAt: record.updatedAt ?? record.createdAt ?? now,
    target: normalizeTarget(record.target, record.project),
  };

  if (!next.project) {
    next.project = inferProject(next.target);
  }
  next.nextRun = next.enabled ? computeNextRunIso(next.schedule) : undefined;
  return next;
}

function normalizeTarget(target: ScheduleTarget | undefined, project?: string): ScheduleTarget {
  if (target?.kind === "team") {
    return {
      kind: "team",
      teamId: target.teamId,
      prompt: target.prompt,
      to: target.to && target.to.trim().length > 0 ? target.to : "*",
    };
  }

  const legacyProject = project && project.trim().length > 0 ? project.trim() : process.env.HOME ?? "~";
  return {
    kind: "prompt",
    tool: target?.kind === "prompt" ? target.tool : "claude",
    cwd: target?.kind === "prompt" ? target.cwd : legacyProject,
    prompt: target?.kind === "prompt" ? target.prompt : "",
    model: target?.kind === "prompt" ? target.model : undefined,
    mode: target?.kind === "prompt" ? target.mode : undefined,
  };
}

function inferProject(target: ScheduleTarget): string | undefined {
  if (target.kind === "prompt") {
    const trimmed = target.cwd.trim();
    if (trimmed.length === 0) return undefined;
    return path.basename(trimmed) || trimmed;
  }
  const team = tm.getTeam(target.teamId);
  return team?.name;
}

function minuteKey(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}

function parseNumber(raw: string, min: number, max: number, weekday = false): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`Invalid cron value "${raw}"`);
  if (weekday && value === 7) return 0;
  if (value < min || value > max) {
    throw new Error(`Cron value "${raw}" out of range ${min}-${max}`);
  }
  return value;
}

function parseCronField(raw: string, min: number, max: number, weekday = false): CronField {
  const text = raw.trim();
  if (!text) throw new Error("Empty cron field");
  if (text === "*") {
    const values = new Set<number>();
    for (let value = min; value <= max; value += 1) {
      values.add(weekday && value === 7 ? 0 : value);
    }
    return { any: true, values };
  }

  const values = new Set<number>();
  for (const segment of text.split(",")) {
    const part = segment.trim();
    if (!part) continue;

    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`Invalid cron step "${part}"`);
    }

    let start = min;
    let end = max;

    if (rangePart !== "*") {
      if (rangePart.includes("-")) {
        const [startPart, endPart] = rangePart.split("-");
        start = parseNumber(startPart, min, max, weekday);
        end = parseNumber(endPart, min, max, weekday);
      } else {
        start = parseNumber(rangePart, min, max, weekday);
        end = start;
      }
    }

    if (start > end) {
      throw new Error(`Invalid cron range "${part}"`);
    }

    for (let value = start; value <= end; value += step) {
      values.add(weekday && value === 7 ? 0 : value);
    }
  }

  if (values.size === 0) {
    throw new Error(`Cron field "${raw}" has no values`);
  }

  return { any: false, values };
}

function parseCron(schedule: string): ParsedCron {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Cron schedule must have 5 fields");
  }

  return {
    minute: parseCronField(parts[0]!, 0, 59),
    hour: parseCronField(parts[1]!, 0, 23),
    dayOfMonth: parseCronField(parts[2]!, 1, 31),
    month: parseCronField(parts[3]!, 1, 12),
    weekday: parseCronField(parts[4]!, 0, 7, true),
  };
}

function cronMatches(parsed: ParsedCron, date: Date): boolean {
  const minuteMatch = parsed.minute.values.has(date.getMinutes());
  const hourMatch = parsed.hour.values.has(date.getHours());
  const monthMatch = parsed.month.values.has(date.getMonth() + 1);
  const dayOfMonthMatch = parsed.dayOfMonth.values.has(date.getDate());
  const weekdayMatch = parsed.weekday.values.has(date.getDay());

  if (!minuteMatch || !hourMatch || !monthMatch) return false;

  if (parsed.dayOfMonth.any && parsed.weekday.any) return true;
  if (parsed.dayOfMonth.any) return weekdayMatch;
  if (parsed.weekday.any) return dayOfMonthMatch;
  return dayOfMonthMatch || weekdayMatch;
}

function computeNextRunIso(schedule: string, from = new Date()): string | undefined {
  const parsed = parseCron(schedule);
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let step = 0; step < MAX_NEXT_RUN_LOOKAHEAD_MINUTES; step += 1) {
    if (cronMatches(parsed, cursor)) {
      return cursor.toISOString();
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return undefined;
}

function validateTarget(target: ScheduleTarget): ScheduleTarget {
  if (target.kind === "team") {
    if (!target.teamId?.trim()) throw new Error("Team schedules require teamId");
    if (!target.prompt?.trim()) throw new Error("Team schedules require a prompt");
    return {
      kind: "team",
      teamId: target.teamId.trim(),
      prompt: target.prompt.trim(),
      to: target.to?.trim() || "*",
    };
  }

  if (!target.cwd?.trim()) throw new Error("Prompt schedules require cwd");
  if (!target.prompt?.trim()) throw new Error("Prompt schedules require a prompt");
  if (!target.tool || !["claude", "codex", "gemini"].includes(target.tool)) {
    throw new Error("Prompt schedules require a valid tool");
  }

  return {
    kind: "prompt",
    tool: target.tool as Tool,
    cwd: target.cwd.trim(),
    prompt: target.prompt.trim(),
    model: target.model?.trim() || undefined,
    mode: target.mode?.trim() || undefined,
  };
}

function persistSchedule(record: ScheduledTask): ScheduledTask {
  const normalized = normalizeSchedule(record);
  schedulesMap()[normalized.id] = normalized;
  sm.persist();
  return normalized;
}

function finalizeSchedule(
  scheduleId: string,
  status: ScheduledTask["lastStatus"],
  error?: string,
  sessionId?: string,
): void {
  const current = schedulesMap()[scheduleId];
  if (!current) return;

  const updated: ScheduledTask = {
    ...current,
    updatedAt: nowISO(),
    lastStatus: status,
    lastError: error,
    lastSessionId: sessionId ?? current.lastSessionId,
  };
  persistSchedule(updated);
  runningScheduleIds.delete(scheduleId);
}

async function waitForScheduledSession(scheduleId: string, sessionId: string): Promise<void> {
  try {
    const res = await sm.waitForIdle(sessionId, 12 * 60 * 60 * 1000);
    if (!res.ok) {
      finalizeSchedule(scheduleId, "failed", res.error ?? "Scheduled session failed", sessionId);
      return;
    }

    const session = sm.getSession(sessionId);
    if (!session) {
      finalizeSchedule(scheduleId, "failed", "Scheduled session disappeared", sessionId);
      return;
    }

    if (session.status === "idle") {
      finalizeSchedule(scheduleId, "success", undefined, sessionId);
      return;
    }

    finalizeSchedule(
      scheduleId,
      "failed",
      session.lastTurn?.error ?? `Scheduled session ended in ${session.status}`,
      sessionId,
    );
  } catch (err) {
    finalizeSchedule(scheduleId, "failed", err instanceof Error ? err.message : String(err), sessionId);
  }
}

async function dispatchSchedule(record: ScheduledTask): Promise<SessionRecord | null> {
  if (record.target.kind === "team") {
    tm.sendMessage(record.target.teamId, "scheduler", record.target.to ?? "*", record.target.prompt);
    finalizeSchedule(record.id, "success");
    return null;
  }

  const session = sm.createSession(
    record.target.tool,
    record.target.cwd,
    record.target.model,
    true,
    undefined,
    undefined,
    { runKind: "scheduled", scheduleId: record.id, scheduleName: record.name },
  );
  const sendRes = sm.sendTurn(session.id, record.target.prompt, {
    mode: record.target.mode,
    model: record.target.model,
  });
  if (!sendRes.ok) {
    sm.removeSession(session.id);
    throw new Error(sendRes.error ?? "Failed to dispatch scheduled prompt");
  }

  persistSchedule({
    ...record,
    lastSessionId: session.id,
  });

  void waitForScheduledSession(record.id, session.id);
  return session;
}

export function initScheduler(): void {
  const state = sm.getState();
  if (state.schedules) {
    for (const [id, record] of Object.entries(state.schedules)) {
      state.schedules[id] = normalizeSchedule(record);
    }
    sm.persist();
  }

  if (schedulerTimer) return;

  void tickSchedules();
  schedulerTimer = setInterval(() => {
    void tickSchedules();
  }, TICK_MS);
  log("Scheduler initialized");
}

export function stopScheduler(): void {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}

async function tickSchedules(): Promise<void> {
  const now = new Date();
  const nowKey = minuteKey(now.toISOString());
  const records = listSchedules();

  for (const record of records) {
    if (!record.enabled || runningScheduleIds.has(record.id) || !nowKey) continue;

    try {
      const parsed = parseCron(record.schedule);
      if (!cronMatches(parsed, now)) continue;
      if (minuteKey(record.lastRun) === nowKey) continue;
      await runSchedule(record.id, "scheduler");
    } catch (err) {
      logError(`[schedule] tick failed for ${record.id}:`, err instanceof Error ? err.message : String(err));
    }
  }
}

export function listSchedules(): ScheduledTask[] {
  return Object.values(schedulesMap())
    .map((record) => normalizeSchedule(record))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getSchedule(scheduleId: string): ScheduledTask | null {
  const record = schedulesMap()[scheduleId];
  return record ? normalizeSchedule(record) : null;
}

export function createSchedule(input: CreateScheduleInput): ScheduledTask {
  if (!input.name?.trim()) throw new Error("Schedule name is required");
  parseCron(input.schedule);

  const target = validateTarget(input.target);
  const now = nowISO();
  const record: ScheduledTask = {
    id: newId("sch"),
    name: input.name.trim(),
    schedule: input.schedule.trim(),
    project: input.project?.trim() || inferProject(target),
    enabled: input.enabled ?? true,
    target,
    createdAt: now,
    updatedAt: now,
    lastStatus: "idle",
  };

  const persisted = persistSchedule(record);
  log(`[schedule] created ${persisted.id} "${persisted.name}"`);
  return persisted;
}

export function updateSchedule(scheduleId: string, updates: UpdateScheduleInput): ScheduledTask | null {
  const current = schedulesMap()[scheduleId];
  if (!current) return null;

  const nextTarget = updates.target ? validateTarget(updates.target) : current.target;
  const nextSchedule = updates.schedule?.trim() ?? current.schedule;
  parseCron(nextSchedule);

  const updated: ScheduledTask = {
    ...current,
    name: updates.name?.trim() || current.name,
    schedule: nextSchedule,
    project: updates.project?.trim() || inferProject(nextTarget) || current.project,
    enabled: updates.enabled ?? current.enabled,
    target: nextTarget,
    updatedAt: nowISO(),
  };

  const persisted = persistSchedule(updated);
  log(`[schedule] updated ${persisted.id} "${persisted.name}"`);
  return persisted;
}

export function deleteSchedule(scheduleId: string): boolean {
  const records = schedulesMap();
  if (!records[scheduleId]) return false;
  delete records[scheduleId];
  runningScheduleIds.delete(scheduleId);
  sm.persist();
  log(`[schedule] deleted ${scheduleId}`);
  return true;
}

export async function runSchedule(
  scheduleId: string,
  trigger: "manual" | "scheduler" = "manual",
): Promise<{ schedule: ScheduledTask; session?: SessionRecord }> {
  const current = schedulesMap()[scheduleId];
  if (!current) throw new Error(`Schedule ${scheduleId} not found`);
  if (runningScheduleIds.has(scheduleId)) {
    throw new Error(`Schedule ${scheduleId} is already running`);
  }

  const record = normalizeSchedule(current);
  if (!record.enabled && trigger === "scheduler") {
    return { schedule: record };
  }

  runningScheduleIds.add(scheduleId);
  const started: ScheduledTask = {
    ...record,
    lastRun: nowISO(),
    lastStatus: "running",
    lastError: undefined,
    updatedAt: nowISO(),
  };
  const persisted = persistSchedule(started);

  let launchedSession: SessionRecord | null = null;
  try {
    launchedSession = await dispatchSchedule(persisted);
  } catch (err) {
    finalizeSchedule(scheduleId, "failed", err instanceof Error ? err.message : String(err));
    throw err;
  }

  log(`[schedule] triggered ${scheduleId} via ${trigger}`);
  return {
    schedule: getSchedule(scheduleId) ?? persisted,
    session: launchedSession ?? undefined,
  };
}
