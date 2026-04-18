import type { TargetProfile, SshCredentials } from "../types";
import type {
  DaemonSessionInfo,
  WorkspaceChatInfo,
  SessionHistoryPayload,
  DaemonOutputLine,
  CodexModelInfo,
} from "./DaemonTransport";
import type { Transport, ScheduledTask, ScheduleDraft, TeamInfo, TeamTaskInfo, TeamMessageInfo, TeamPlanInfo, TeamMemberInput, TeamPlanInput, TeamPlanSubmitOpts, BridgeRuntimeConfig, FollowUpSuggestion } from "./Transport";

export class BridgeTransport implements Transport {
  private readonly activeControllers = new Set<AbortController>();

  private async rpc(
    target: TargetProfile,
    credentials: SshCredentials,
    cmd: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const url = `${target.bridgeUrl}/api/rpc`;
    const controller = new AbortController();
    this.activeControllers.add(controller);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credentials.bridgeToken}`,
        },
        body: JSON.stringify({ cmd, ...params }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Bridge HTTP ${resp.status}${body ? `: ${body}` : ""}`);
      }
      return (await resp.json()) as Record<string, unknown>;
    } finally {
      this.activeControllers.delete(controller);
    }
  }

  async createSession(
    target: TargetProfile,
    credentials: SshCredentials,
    opts: { tool: string; cwd: string; model?: string; conversationId?: string },
  ): Promise<{ daemonSessionId: string }> {
    const params: Record<string, unknown> = {
      tool: opts.tool,
      cwd: opts.cwd,
      autoAccept: true,
    };
    if (opts.model) params.model = opts.model;
    if (opts.conversationId) params.conversationId = opts.conversationId;

    const resp = await this.rpc(target, credentials, "session.create", params);
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge session create failed");
    }
    const session = resp.session as Record<string, unknown> | undefined;
    if (!session?.id) {
      throw new Error("Bridge returned no session ID");
    }
    return { daemonSessionId: session.id as string };
  }

  async sendTurn(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    prompt: string,
    options?: { mode?: string; model?: string },
  ): Promise<void> {
    const params: Record<string, unknown> = { id: daemonSessionId, prompt };
    if (options?.mode) params.mode = options.mode;
    if (options?.model) params.model = options.model;

    const resp = await this.rpc(target, credentials, "session.send", params);
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge send failed");
    }
  }

  async streamOutput(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    offset: number,
    onLine: (parsed: DaemonOutputLine) => void,
    signal?: { cancelled: boolean },
  ): Promise<number> {
    const url = `${target.bridgeUrl}/api/sessions/${encodeURIComponent(daemonSessionId)}/stream?offset=${offset}`;
    const controller = new AbortController();
    this.activeControllers.add(controller);

    let lineCount = offset;

    try {
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${credentials.bridgeToken}`,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`Bridge stream HTTP ${resp.status}`);
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        throw new Error("Bridge stream: no readable body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let turnEnded = false;

      while (!turnEnded) {
        if (signal?.cancelled) {
          controller.abort();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");

          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(jsonStr) as DaemonOutputLine;
            lineCount++;
            onLine(parsed);

            if (parsed.t === "m" && parsed.event === "turn_end") {
              turnEnded = true;
              break;
            }
          } catch {
            // Non-JSON SSE data, skip
          }
        }
      }

      reader.cancel().catch(() => {});
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Expected when cancelled
      } else if (!signal?.cancelled) {
        // Fallback: poll-based streaming
        return this.pollStream(target, credentials, daemonSessionId, lineCount, onLine, signal);
      }
    } finally {
      this.activeControllers.delete(controller);
    }

    return lineCount;
  }

  private async pollStream(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    offset: number,
    onLine: (parsed: DaemonOutputLine) => void,
    signal?: { cancelled: boolean },
  ): Promise<number> {
    let lineCount = offset;
    const POLL_INTERVAL = 500;
    const MAX_POLLS = 600; // 5 minutes max

    for (let i = 0; i < MAX_POLLS; i++) {
      if (signal?.cancelled) break;

      const resp = await this.rpc(target, credentials, "session.get", { id: daemonSessionId });
      const session = resp.session as Record<string, unknown> | undefined;
      const outputLines = (session?.outputLines as number) ?? 0;

      if (outputLines > lineCount) {
        // Fetch new output lines via history
        try {
          const histResp = await this.rpc(target, credentials, "session.history", {
            id: daemonSessionId,
            limitLines: outputLines - lineCount,
          });
          const history = histResp.history as { lines?: string[] } | undefined;
          if (history?.lines) {
            for (const rawLine of history.lines) {
              try {
                const parsed = JSON.parse(rawLine) as DaemonOutputLine;
                lineCount++;
                onLine(parsed);

                if (parsed.t === "m" && parsed.event === "turn_end") {
                  return lineCount;
                }
              } catch {
                // skip
              }
            }
          }
        } catch {
          // retry next poll
        }
      }

      const status = session?.status as string | undefined;
      if (status && status !== "running") {
        break;
      }

      await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL));
    }

    return lineCount;
  }

  async cancelTurn(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
  ): Promise<void> {
    const resp = await this.rpc(target, credentials, "session.cancel", { id: daemonSessionId });
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge cancel failed");
    }
  }

  async getSession(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
  ): Promise<DaemonSessionInfo> {
    const resp = await this.rpc(target, credentials, "session.get", { id: daemonSessionId });
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge get session failed");
    }
    return resp.session as unknown as DaemonSessionInfo;
  }

  async listSessions(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<DaemonSessionInfo[]> {
    const resp = await this.rpc(target, credentials, "session.list");
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge list sessions failed");
    }
    const sessions = resp.sessions;
    return Array.isArray(sessions) ? (sessions as unknown as DaemonSessionInfo[]) : [];
  }

  async listSessionCatalog(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<WorkspaceChatInfo[]> {
    const resp = await this.rpc(target, credentials, "session.catalog");
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge session catalog failed");
    }
    const sessions = resp.sessions;
    return Array.isArray(sessions) ? (sessions as unknown as WorkspaceChatInfo[]) : [];
  }

  async listWorkspaceSessions(
    target: TargetProfile,
    credentials: SshCredentials,
    cwd: string,
  ): Promise<WorkspaceChatInfo[]> {
    const resp = await this.rpc(target, credentials, "session.list_workspace", { cwd });
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge list workspace sessions failed");
    }
    const sessions = resp.sessions;
    return Array.isArray(sessions) ? (sessions as unknown as WorkspaceChatInfo[]) : [];
  }

  async getHistory(
    target: TargetProfile,
    credentials: SshCredentials,
    opts: {
      daemonSessionId?: string;
      tool?: "claude" | "codex";
      resumeId?: string;
      cwd?: string;
      limitLines?: number;
    },
  ): Promise<SessionHistoryPayload> {
    const params: Record<string, unknown> = {};
    if (opts.daemonSessionId) params.id = opts.daemonSessionId;
    if (opts.tool) params.tool = opts.tool;
    if (opts.resumeId) params.resumeId = opts.resumeId;
    if (opts.cwd) params.cwd = opts.cwd;
    if (opts.limitLines) params.limitLines = opts.limitLines;

    const resp = await this.rpc(target, credentials, "session.history", params);
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge history failed");
    }
    return resp.history as SessionHistoryPayload;
  }

  async waitUntilIdle(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    timeoutMs = 120000,
  ): Promise<{ timedOut: boolean }> {
    const resp = await this.rpc(target, credentials, "session.wait_idle", {
      id: daemonSessionId,
      timeoutMs,
    });
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge wait-idle failed");
    }
    return { timedOut: resp.timedOut === true };
  }

  async removeSession(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
  ): Promise<void> {
    const resp = await this.rpc(target, credentials, "session.remove", { id: daemonSessionId });
    if (!resp.ok) {
      const error = (resp.error as string) ?? "";
      if (!error.includes("not found")) {
        throw new Error(error || "Bridge remove session failed");
      }
    }
  }

  async listCodexModels(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<CodexModelInfo[]> {
    const resp = await this.rpc(target, credentials, "model.list", { tool: "codex" });
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge list codex models failed");
    }
    const models = resp.models;
    if (!Array.isArray(models)) return [];
    return models.map((m: Record<string, unknown>) => ({
      id: (m.id as string) ?? "",
      displayName: (m.displayName as string) || (m.id as string) || "",
      hidden: m.hidden === true,
      isDefault: m.isDefault === true,
    })).filter((m) => m.id.length > 0);
  }

  async sessionSuggest(
    target: TargetProfile,
    credentials: SshCredentials,
    daemonSessionId: string,
    limit = 4,
  ): Promise<FollowUpSuggestion[]> {
    const resp = await this.rpc(target, credentials, "session.suggest", {
      id: daemonSessionId,
      limit,
    });
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge suggest failed");
    }
    return Array.isArray(resp.suggestions) ? (resp.suggestions as FollowUpSuggestion[]) : [];
  }

  async registerPushToken(
    target: TargetProfile,
    credentials: SshCredentials,
    token: string,
  ): Promise<void> {
    try {
      await this.rpc(target, credentials, "config.setPushToken", { token });
    } catch (err) {
      __DEV__ && console.log(`[OV:bridge] registerPushToken error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async bridgeConfigGet(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<BridgeRuntimeConfig> {
    const resp = await this.rpc(target, credentials, "bridge.config");
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge config get failed");
    }
    return resp.bridgeConfig as BridgeRuntimeConfig;
  }

  async bridgeConfigUpdate(
    target: TargetProfile,
    credentials: SshCredentials,
    updates: Partial<BridgeRuntimeConfig>,
  ): Promise<BridgeRuntimeConfig> {
    const resp = await this.rpc(target, credentials, "bridge.config", updates as unknown as Record<string, unknown>);
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Bridge config update failed");
    }
    return resp.bridgeConfig as BridgeRuntimeConfig;
  }

  async resetAllConnections(): Promise<void> {
    for (const controller of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
  }

  // ── Channel commands ──

  // ── Remote + Schedule commands ──

  async sessionRemote(
    target: TargetProfile,
    credentials: SshCredentials,
    sessionId: string,
  ): Promise<{ remoteUrl: string }> {
    const resp = await this.rpc(target, credentials, "session.remote", { id: sessionId });
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Remote failed");
    }
    return { remoteUrl: resp.remoteUrl as string };
  }

  async scheduleList(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<ScheduledTask[]> {
    const resp = await this.rpc(target, credentials, "schedule.list");
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Schedule list failed");
    }
    return (resp.schedules as ScheduledTask[]) ?? [];
  }

  async scheduleGet(
    target: TargetProfile,
    credentials: SshCredentials,
    scheduleId: string,
  ): Promise<ScheduledTask> {
    const resp = await this.rpc(target, credentials, "schedule.get", { id: scheduleId });
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Schedule get failed");
    }
    return resp.schedule as ScheduledTask;
  }

  async scheduleCreate(
    target: TargetProfile,
    credentials: SshCredentials,
    schedule: ScheduleDraft,
  ): Promise<ScheduledTask> {
    const resp = await this.rpc(target, credentials, "schedule.create", schedule as unknown as Record<string, unknown>);
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Schedule create failed");
    }
    return resp.schedule as ScheduledTask;
  }

  async scheduleUpdate(
    target: TargetProfile,
    credentials: SshCredentials,
    scheduleId: string,
    updates: Partial<ScheduleDraft>,
  ): Promise<ScheduledTask> {
    const resp = await this.rpc(target, credentials, "schedule.update", {
      id: scheduleId,
      ...(updates as unknown as Record<string, unknown>),
    });
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Schedule update failed");
    }
    return resp.schedule as ScheduledTask;
  }

  async scheduleDelete(
    target: TargetProfile,
    credentials: SshCredentials,
    scheduleId: string,
  ): Promise<void> {
    const resp = await this.rpc(target, credentials, "schedule.delete", { id: scheduleId });
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Schedule delete failed");
    }
  }

  async scheduleRun(
    target: TargetProfile,
    credentials: SshCredentials,
    taskId: string,
  ): Promise<void> {
    const resp = await this.rpc(target, credentials, "schedule.run", { taskId });
    if (!resp.ok) {
      throw new Error((resp.error as string) ?? "Schedule run failed");
    }
  }

  // ── Team commands ──

  async teamCreate(
    target: TargetProfile,
    credentials: SshCredentials,
    opts: { name: string; cwd: string; members: TeamMemberInput[] },
  ): Promise<TeamInfo> {
    const resp = await this.rpc(target, credentials, "team.create", { name: opts.name, cwd: opts.cwd, members: opts.members });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team create failed");
    return resp.team as unknown as TeamInfo;
  }

  async teamList(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<TeamInfo[]> {
    const resp = await this.rpc(target, credentials, "team.list");
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team list failed");
    return (resp.teams as unknown as TeamInfo[]) ?? [];
  }

  async teamGet(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
  ): Promise<TeamInfo> {
    const resp = await this.rpc(target, credentials, "team.get", { teamId });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team get failed");
    return resp.team as unknown as TeamInfo;
  }

  async teamUpdate(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    updates: { name?: string; cwd?: string; members?: TeamMemberInput[] },
  ): Promise<TeamInfo> {
    const resp = await this.rpc(target, credentials, "team.update", { teamId, ...updates });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team update failed");
    return resp.team as unknown as TeamInfo;
  }

  async teamDelete(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
  ): Promise<void> {
    const resp = await this.rpc(target, credentials, "team.delete", { teamId });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team delete failed");
  }

  async teamTaskCreate(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    task: { subject: string; description: string; owner: string; dependencies?: string[] },
  ): Promise<TeamTaskInfo> {
    const resp = await this.rpc(target, credentials, "team.task.create", { teamId, ...task });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team task create failed");
    return resp.teamTask as unknown as TeamTaskInfo;
  }

  async teamTaskUpdate(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    taskId: string,
    updates: { status?: string; owner?: string; description?: string },
  ): Promise<TeamTaskInfo> {
    const resp = await this.rpc(target, credentials, "team.task.update", { teamId, taskId, ...updates });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team task update failed");
    return resp.teamTask as unknown as TeamTaskInfo;
  }

  async teamTaskList(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
  ): Promise<TeamTaskInfo[]> {
    const resp = await this.rpc(target, credentials, "team.task.list", { teamId });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team task list failed");
    return (resp.teamTasks as unknown as TeamTaskInfo[]) ?? [];
  }

  async teamTaskComment(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    taskId: string,
    author: string,
    text: string,
  ): Promise<void> {
    const resp = await this.rpc(target, credentials, "team.task.comment", { teamId, taskId, author, text });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team task comment failed");
  }

  async teamMessageSend(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    from: string,
    to: string,
    text: string,
  ): Promise<void> {
    const resp = await this.rpc(target, credentials, "team.message.send", { teamId, from, to, text });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team message send failed");
  }

  async teamMessageList(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    limit?: number,
  ): Promise<TeamMessageInfo[]> {
    const params: Record<string, unknown> = { teamId };
    if (limit !== undefined) params.limit = limit;
    const resp = await this.rpc(target, credentials, "team.message.list", params);
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team message list failed");
    return (resp.teamMessages as unknown as TeamMessageInfo[]) ?? [];
  }

  async teamPlanGenerate(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    request: string,
    opts?: TeamPlanSubmitOpts,
  ): Promise<void> {
    const resp = await this.rpc(target, credentials, "team.plan.generate", {
      teamId,
      request,
      mode: opts?.mode,
      reviewers: opts?.reviewers,
      maxIterations: opts?.maxIterations,
    });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team plan generate failed");
  }

  async teamPlanSubmit(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    plan: TeamPlanInput,
    opts?: TeamPlanSubmitOpts,
  ): Promise<TeamPlanInfo> {
    const params: Record<string, unknown> = { teamId, tasks: plan.tasks };
    if (opts?.mode) params.mode = opts.mode;
    if (opts?.reviewers) params.reviewers = opts.reviewers;
    if (opts?.maxIterations !== undefined) params.maxIterations = opts.maxIterations;
    const resp = await this.rpc(target, credentials, "team.plan.submit", params);
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team plan submit failed");
    return resp.teamPlan as unknown as TeamPlanInfo;
  }

  async teamPlanReview(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    planId: string,
    reviewer: string,
    vote: "approve" | "revise" | "reject",
    feedback?: string,
  ): Promise<TeamPlanInfo> {
    const params: Record<string, unknown> = { teamId, planId, reviewer, vote };
    if (feedback !== undefined) params.feedback = feedback;
    const resp = await this.rpc(target, credentials, "team.plan.review", params);
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team plan review failed");
    return resp.teamPlan as unknown as TeamPlanInfo;
  }

  async teamPlanRevise(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    planId: string,
    author: string,
    revision: TeamPlanInput,
  ): Promise<TeamPlanInfo> {
    const resp = await this.rpc(target, credentials, "team.plan.revise", { teamId, planId, author, revision: { tasks: revision.tasks } });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team plan revise failed");
    return resp.teamPlan as unknown as TeamPlanInfo;
  }

  async teamPlanGet(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    planId: string,
  ): Promise<TeamPlanInfo> {
    const resp = await this.rpc(target, credentials, "team.plan.get", { teamId, planId });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team plan get failed");
    return resp.teamPlan as unknown as TeamPlanInfo;
  }

  async teamPlanLatest(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
  ): Promise<TeamPlanInfo | null> {
    const resp = await this.rpc(target, credentials, "team.plan.latest", { teamId });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team plan latest failed");
    return (resp.teamPlan as TeamPlanInfo | undefined) ?? null;
  }

  async teamPlanDelete(
    target: TargetProfile,
    credentials: SshCredentials,
    teamId: string,
    planId: string,
  ): Promise<void> {
    const resp = await this.rpc(target, credentials, "team.plan.delete", { teamId, planId });
    if (!resp.ok) throw new Error((resp.error as string) ?? "Team plan delete failed");
  }
}
