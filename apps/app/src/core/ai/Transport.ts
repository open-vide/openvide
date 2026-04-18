import type { TargetProfile, SshCredentials } from "../types";
import type {
  DaemonSessionInfo,
  WorkspaceChatInfo,
  SessionHistoryPayload,
  DaemonOutputLine,
  CodexModelInfo,
} from "./DaemonTransport";

export interface Transport {
  createSession(
    target: TargetProfile,
    credentials: SshCredentials,
    opts: { tool: string; cwd: string; model?: string; conversationId?: string },
  ): Promise<{ daemonSessionId: string }>;

  sendTurn(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    prompt: string,
    options?: { mode?: string; model?: string },
  ): Promise<void>;

  streamOutput(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    offset: number,
    onLine: (parsed: DaemonOutputLine) => void,
    signal?: { cancelled: boolean },
  ): Promise<number>;

  cancelTurn(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
  ): Promise<void>;

  getSession(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
  ): Promise<DaemonSessionInfo>;

  listSessions(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<DaemonSessionInfo[]>;

  listSessionCatalog(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<WorkspaceChatInfo[]>;

  listWorkspaceSessions(
    target: TargetProfile,
    credentials: SshCredentials,
    cwd: string,
  ): Promise<WorkspaceChatInfo[]>;

  getHistory(
    target: TargetProfile,
    credentials: SshCredentials,
    opts: {
      daemonSessionId?: string;
      tool?: "claude" | "codex";
      resumeId?: string;
      cwd?: string;
      limitLines?: number;
    },
  ): Promise<SessionHistoryPayload>;

  waitUntilIdle(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    timeoutMs?: number,
  ): Promise<{ timedOut: boolean }>;

  removeSession(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
  ): Promise<void>;

  listCodexModels(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<CodexModelInfo[]>;

  sessionSuggest(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    limit?: number,
  ): Promise<FollowUpSuggestion[]>;

  registerPushToken(
    target: TargetProfile,
    credentials: SshCredentials,
    token: string,
  ): Promise<void>;

  bridgeConfigGet(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<BridgeRuntimeConfig>;

  bridgeConfigUpdate(
    target: TargetProfile,
    credentials: SshCredentials,
    updates: Partial<BridgeRuntimeConfig>,
  ): Promise<BridgeRuntimeConfig>;

  resetAllConnections(): Promise<void>;

  // ── Remote + Schedule commands (Claude-only) ──

  sessionRemote(
    target: TargetProfile,
    credentials: SshCredentials,
    sessionId: string,
  ): Promise<{ remoteUrl: string }>;

  scheduleList(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<ScheduledTask[]>;

  scheduleGet(
    target: TargetProfile,
    credentials: SshCredentials,
    scheduleId: string,
  ): Promise<ScheduledTask>;

  scheduleCreate(
    target: TargetProfile,
    credentials: SshCredentials,
    schedule: ScheduleDraft,
  ): Promise<ScheduledTask>;

  scheduleUpdate(
    target: TargetProfile,
    credentials: SshCredentials,
    scheduleId: string,
    updates: Partial<ScheduleDraft>,
  ): Promise<ScheduledTask>;

  scheduleDelete(
    target: TargetProfile,
    credentials: SshCredentials,
    scheduleId: string,
  ): Promise<void>;

  scheduleRun(
    target: TargetProfile,
    credentials: SshCredentials,
    taskId: string,
  ): Promise<void>;

  // ── Team commands ──
  teamCreate(target: TargetProfile, credentials: SshCredentials, opts: { name: string; cwd: string; members: TeamMemberInput[] }): Promise<TeamInfo>;
  teamList(target: TargetProfile, credentials: SshCredentials): Promise<TeamInfo[]>;
  teamGet(target: TargetProfile, credentials: SshCredentials, teamId: string): Promise<TeamInfo>;
  teamUpdate(target: TargetProfile, credentials: SshCredentials, teamId: string, updates: { name?: string; cwd?: string; members?: TeamMemberInput[] }): Promise<TeamInfo>;
  teamDelete(target: TargetProfile, credentials: SshCredentials, teamId: string): Promise<void>;
  teamTaskCreate(target: TargetProfile, credentials: SshCredentials, teamId: string, task: { subject: string; description: string; owner: string; dependencies?: string[] }): Promise<TeamTaskInfo>;
  teamTaskUpdate(target: TargetProfile, credentials: SshCredentials, teamId: string, taskId: string, updates: { status?: string; owner?: string; description?: string }): Promise<TeamTaskInfo>;
  teamTaskList(target: TargetProfile, credentials: SshCredentials, teamId: string): Promise<TeamTaskInfo[]>;
  teamTaskComment(target: TargetProfile, credentials: SshCredentials, teamId: string, taskId: string, author: string, text: string): Promise<void>;
  teamMessageSend(target: TargetProfile, credentials: SshCredentials, teamId: string, from: string, to: string, text: string): Promise<void>;
  teamMessageList(target: TargetProfile, credentials: SshCredentials, teamId: string, limit?: number): Promise<TeamMessageInfo[]>;
  teamPlanGenerate(target: TargetProfile, credentials: SshCredentials, teamId: string, request: string, opts?: TeamPlanSubmitOpts): Promise<void>;
  teamPlanSubmit(target: TargetProfile, credentials: SshCredentials, teamId: string, plan: TeamPlanInput, opts?: TeamPlanSubmitOpts): Promise<TeamPlanInfo>;
  teamPlanReview(target: TargetProfile, credentials: SshCredentials, teamId: string, planId: string, reviewer: string, vote: "approve" | "revise" | "reject", feedback?: string): Promise<TeamPlanInfo>;
  teamPlanRevise(target: TargetProfile, credentials: SshCredentials, teamId: string, planId: string, author: string, revision: TeamPlanInput): Promise<TeamPlanInfo>;
  teamPlanGet(target: TargetProfile, credentials: SshCredentials, teamId: string, planId: string): Promise<TeamPlanInfo>;
  teamPlanLatest(target: TargetProfile, credentials: SshCredentials, teamId: string): Promise<TeamPlanInfo | null>;
  teamPlanDelete(target: TargetProfile, credentials: SshCredentials, teamId: string, planId: string): Promise<void>;
}

export interface ScheduledTask {
  id: string;
  targetId?: string;
  targetLabel?: string;
  name: string;
  schedule: string;
  project?: string;
  enabled: boolean;
  target: ScheduleTarget;
  createdAt: string;
  updatedAt: string;
  lastRun?: string;
  lastStatus?: "idle" | "running" | "success" | "failed";
  lastError?: string;
  nextRun?: string;
  lastSessionId?: string;
}

export interface PromptScheduleTarget {
  kind: "prompt";
  tool: string;
  cwd: string;
  prompt: string;
  model?: string;
  mode?: string;
}

export interface TeamScheduleTarget {
  kind: "team";
  teamId: string;
  prompt: string;
  to?: string;
}

export type ScheduleTarget = PromptScheduleTarget | TeamScheduleTarget;

export interface ScheduleDraft {
  name: string;
  schedule: string;
  project?: string;
  enabled?: boolean;
  target: ScheduleTarget;
}

export interface TeamMemberInput { name: string; tool: string; model?: string; role: string }
export interface TeamInfo { id: string; targetId?: string; targetLabel?: string; name: string; workingDirectory: string; members: (TeamMemberInput & { sessionId: string })[]; createdAt: string; updatedAt: string; taskCount?: number; tasksTotal?: number; tasksDone?: number; activeCount?: number; latestPlanId?: string }
export interface TeamTaskInfo { id: string; teamId: string; subject: string; description: string; owner: string; status: string; dependencies: string[]; blockedBy: string[]; comments: { id: string; author: string; text: string; createdAt: string }[]; createdAt: string; updatedAt: string }
export interface TeamMessageInfo { id: string; teamId: string; from: string; fromTool?: string; to: string; text: string; createdAt: string }
export interface TeamPlanInput { tasks: { subject: string; description: string; owner: string; dependencies?: string[] }[] }
export interface TeamPlanSubmitOpts { mode?: "simple" | "consensus"; reviewers?: string[]; maxIterations?: number }
export interface TeamPlanInfo { id: string; teamId: string; status: string; mode: string; revisions: any[]; votes: any[]; iteration: number; maxIterations: number; reviewers: string[]; createdBy: string; createdAt: string; updatedAt: string }

export interface BridgeRuntimeConfig {
  enabled: boolean;
  port: number;
  tls: boolean;
  defaultCwd: string;
  evenAiTool: "claude" | "codex" | "gemini";
  evenAiMode: "new" | "last" | "pinned";
  evenAiPinnedSessionId: string;
  currentEvenAiSessionId: string;
}

export interface FollowUpSuggestion {
  id?: string;
  label: string;
  prompt: string;
  source: "ai" | "heuristic";
}
