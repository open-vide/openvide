import { AppState, type AppStateStatus } from "react-native";
import { newId } from "../id";
import {
  notifySessionComplete,
  notifySessionFailed,
  notifySessionNeedsInput,
} from "../notifications";
import type {
  AiContentBlock,
  AiMessage,
  AiSession,
  AiSessionStatus,
  AiTurn,
  SshCredentials,
  TargetProfile,
  ToolName,
} from "../types";
import { getContextWindow, getDefaultModel } from "../modelOptions";
import { getAdapter } from "./adapterRegistry";
import type { CliStreamEvent } from "./adapterTypes";
import { DaemonTransport, type DaemonOutputLine } from "./DaemonTransport";

type SessionListener = (session: AiSession) => void;

function cloneSession(session: AiSession): AiSession {
  return JSON.parse(JSON.stringify(session)) as AiSession;
}

export class SessionEngine {
  private readonly transport: DaemonTransport;
  private readonly persist: (session: AiSession) => Promise<void>;
  private readonly sessions = new Map<string, AiSession>();
  private readonly listeners = new Map<string, Set<SessionListener>>();
  private readonly cancelHandles = new Map<string, () => Promise<void>>();
  private readonly pendingNotify = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly activeTurns = new Map<string, Promise<void>>();
  private readonly activeAttaches = new Map<string, Promise<void>>();
  private appState: AppStateStatus = AppState.currentState;
  notificationsEnabled = true;

  private static readonly NOTIFY_THROTTLE_MS = 100;

  constructor(
    transport: DaemonTransport,
    persist: (session: AiSession) => Promise<void>,
  ) {
    this.transport = transport;
    this.persist = persist;
    AppState.addEventListener("change", (nextState) => {
      this.appState = nextState;
    });
  }

  subscribe(sessionId: string, listener: SessionListener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<SessionListener>();
    set.add(listener);
    this.listeners.set(sessionId, set);

    return () => {
      const current = this.listeners.get(sessionId);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  private notify(session: AiSession): void {
    const listeners = this.listeners.get(session.id);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(cloneSession(session));
    }
  }

  private notifyThrottled(session: AiSession): void {
    if (this.pendingNotify.has(session.id)) {
      return;
    }
    const timer = setTimeout(() => {
      this.pendingNotify.delete(session.id);
      // Guard: session may have been removed while timer was pending
      if (!this.sessions.has(session.id)) return;
      this.notify(session);
    }, SessionEngine.NOTIFY_THROTTLE_MS);
    this.pendingNotify.set(session.id, timer);
  }

  private flushNotify(session: AiSession): void {
    const timer = this.pendingNotify.get(session.id);
    if (timer) {
      clearTimeout(timer);
      this.pendingNotify.delete(session.id);
    }
    this.notify(session);
  }

  private updateStatus(session: AiSession, status: AiSessionStatus): void {
    session.status = status;
    session.updatedAt = new Date().toISOString();
  }

  private addMessage(session: AiSession, message: AiMessage): void {
    session.messages.push(message);
    session.updatedAt = new Date().toISOString();
  }

  private applyContextSnapshot(
    session: AiSession,
    input: {
      usedTokens?: number;
      windowTokens?: number;
      source?: "provider" | "derived";
    },
  ): void {
    const used = input.usedTokens;
    if (used == null || !Number.isFinite(used) || used < 0) {
      return;
    }
    const defaultWindow = getContextWindow(session.model ?? getDefaultModel(session.tool));
    const window = input.windowTokens ?? defaultWindow;

    session.contextStatus = "ok";
    session.contextUsedTokens = Math.floor(used);
    session.contextWindowTokens = window > 0 ? Math.floor(window) : undefined;
    session.contextPercentUsed = session.contextWindowTokens && session.contextWindowTokens > 0
      ? Math.max(0, Math.min((session.contextUsedTokens / session.contextWindowTokens) * 100, 100))
      : undefined;
    session.contextSource = input.source ?? "derived";
    session.contextLabel = undefined;
  }

  private getOrCreateAssistantMessage(session: AiSession, turnIndex: number): AiMessage {
    const last = session.messages[session.messages.length - 1];
    if (last && last.role === "assistant" && last.turnIndex === turnIndex) {
      return last;
    }

    const message: AiMessage = {
      id: newId("msg"),
      role: "assistant",
      content: [],
      timestamp: new Date().toISOString(),
      turnIndex,
      isStreaming: true,
    };
    this.addMessage(session, message);
    return message;
  }

  private processEvent(
    session: AiSession,
    event: CliStreamEvent,
    turnIndex: number,
  ): void {
    console.log("[OV:engine] processEvent:", event.type, event.block?.type ?? "", session.id);

    if (event.type === "message_start") {
      this.getOrCreateAssistantMessage(session, turnIndex);
      return;
    }

    if (event.type === "content_block" && event.block) {
      const msg = this.getOrCreateAssistantMessage(session, turnIndex);

      // Track tool status
      if (event.block.type === "tool_use") {
        event.block.toolStatus = "running";
        const toolName = event.block.toolName ?? "tool";
        const input = event.block.toolInput as Record<string, unknown> | undefined;
        const detail = (input?.["file_path"] as string) ?? (input?.["command"] as string) ?? "";
        event.block.activityText = detail ? `${toolName}: ${detail.slice(0, 80)}` : toolName;

        // Set awaiting_input when the AI asks the user a question
        if (toolName === "AskUserQuestion") {
          this.updateStatus(session, "awaiting_input");
          if (this.notificationsEnabled && this.appState !== "active") {
            notifySessionNeedsInput(session.id, session.tool).catch(() => {});
          }
        }
      } else if (event.block.type === "tool_result" && event.block.toolId) {
        // Find matching tool_use and update its status
        for (let i = msg.content.length - 1; i >= 0; i--) {
          const b = msg.content[i];
          if (b && b.type === "tool_use" && b.toolId === event.block.toolId) {
            b.toolStatus = event.block.isError ? "error" : "completed";
            break;
          }
        }
      }

      msg.content.push(event.block);
      console.log("[OV:engine] content_block added:", event.block.type, "text=" + (event.block.text?.slice(0, 60) ?? ""), "blocks_total=" + msg.content.length);
      return;
    }

    if (event.type === "usage") {
      if (event.inputTokens == null && event.outputTokens == null) {
        this.applyContextSnapshot(session, {
          usedTokens: event.contextUsedTokens,
          windowTokens: event.contextWindowTokens,
          source: event.contextSource,
        });
        return;
      }
      const msg = this.getOrCreateAssistantMessage(session, turnIndex);
      const usageBlock: AiContentBlock = {
        type: "usage",
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      };
      msg.content.push(usageBlock);
      session.totalInputTokens = (session.totalInputTokens ?? 0) + (event.inputTokens ?? 0);
      session.totalOutputTokens = (session.totalOutputTokens ?? 0) + (event.outputTokens ?? 0);
      this.applyContextSnapshot(session, {
        usedTokens: event.contextUsedTokens ?? event.inputTokens,
        windowTokens: event.contextWindowTokens,
        source: event.contextSource,
      });
      console.log("[OV:engine] usage:", event.inputTokens, "in /", event.outputTokens, "out", "total:", session.totalInputTokens, "/", session.totalOutputTokens);
      return;
    }

    if (event.type === "message_complete") {
      if (event.conversationId) {
        session.conversationId = event.conversationId;
        console.log("[OV:engine] conversationId captured:", event.conversationId);
      }
      const last = session.messages[session.messages.length - 1];
      if (last && last.role === "assistant") {
        last.isStreaming = false;
      }
      console.log("[OV:engine] message_complete, total messages:", session.messages.length);
      return;
    }

    if (event.type === "error" && event.block) {
      const msg = this.getOrCreateAssistantMessage(session, turnIndex);
      msg.content.push(event.block);
      console.warn("[OV:engine] error event:", event.block.text);
      return;
    }
  }

  async createSession(input: {
    targetId: string;
    workspaceId?: string;
    tool: ToolName;
    workingDirectory?: string;
    model?: string;
  }): Promise<AiSession> {
    console.log("[OV:engine] createSession (draft):", input.tool, "target=" + input.targetId);
    const session: AiSession = {
      id: newId("session"),
      targetId: input.targetId,
      workspaceId: input.workspaceId,
      tool: input.tool,
      status: "idle",
      messages: [],
      turns: [],
      workingDirectory: input.workingDirectory,
      model: input.model,
      contextStatus: "unavailable",
      contextLabel: "Context N/A",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(session.id, session);
    this.notify(session);
    await this.persist(session);

    console.log("[OV:engine] createSession done:", session.id);
    return cloneSession(session);
  }

  async startSession(input: {
    target: TargetProfile;
    credentials: SshCredentials;
    tool: ToolName;
    prompt: string;
    workingDirectory?: string;
    allowedTools?: string[];
    model?: string;
    autoAccept?: boolean;
  }): Promise<AiSession> {
    console.log("[OV:engine] startSession:", input.tool, "target=" + input.target.label, "prompt=" + input.prompt.slice(0, 80));
    const session: AiSession = {
      id: newId("session"),
      targetId: input.target.id,
      tool: input.tool,
      status: "idle",
      messages: [],
      turns: [],
      workingDirectory: input.workingDirectory,
      model: input.model,
      contextStatus: "unavailable",
      contextLabel: "Context N/A",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    console.log("[OV:engine] session created:", session.id);
    this.sessions.set(session.id, session);
    this.notify(session);
    await this.persist(session);

    const turnPromise = this.executeTurn(session, input.target, input.credentials, input.prompt, input.allowedTools, input.autoAccept).catch((err) => {
      console.error("[OV:engine] background executeTurn error:", err);
    });
    this.activeTurns.set(session.id, turnPromise);
    turnPromise.finally(() => {
      this.activeTurns.delete(session.id);
    });

    console.log("[OV:engine] startSession done:", session.id, "turn dispatched in background");
    return cloneSession(session);
  }

  async sendPrompt(
    sessionId: string,
    input: {
      target: TargetProfile;
      credentials: SshCredentials;
      prompt: string;
      autoAccept?: boolean;
    },
  ): Promise<void> {
    console.log("[OV:engine] sendPrompt:", sessionId, "prompt=" + input.prompt.slice(0, 80));
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error("[OV:engine] sendPrompt FAILED: session not found", sessionId);
      throw new Error("Session not found");
    }
    console.log("[OV:engine] sendPrompt: current status=" + session.status, "conversationId=" + (session.conversationId ?? "none"));

    // Chain after any active turn — allows message queuing instead of rejecting
    const prev = Promise.all([
      this.activeTurns.get(sessionId) ?? Promise.resolve(),
      this.activeAttaches.get(sessionId) ?? Promise.resolve(),
    ]).then(() => {});
    const turnPromise = prev.then(async () => {
      // Re-check session still exists after waiting
      if (!this.sessions.has(sessionId)) return;
      const s = this.sessions.get(sessionId)!;
      await this.executeTurn(s, input.target, input.credentials, input.prompt, undefined, input.autoAccept);
    }).catch((err) => {
      console.error("[OV:engine] chained executeTurn error:", err);
    });
    this.activeTurns.set(sessionId, turnPromise);
    turnPromise.finally(() => {
      if (this.activeTurns.get(sessionId) === turnPromise) {
        this.activeTurns.delete(sessionId);
      }
    });
  }

  async cancelTurn(sessionId: string): Promise<boolean> {
    console.log("[OV:engine] cancelTurn:", sessionId);
    const cancel = this.cancelHandles.get(sessionId);
    if (!cancel) {
      console.warn("[OV:engine] cancelTurn: no cancel handle found for", sessionId);
      return false;
    }

    try {
      await cancel();
    } catch {
      // no-op
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      const currentTurn = session.turns[session.turns.length - 1];
      if (currentTurn && !currentTurn.endedAt) {
        currentTurn.endedAt = new Date().toISOString();
        currentTurn.error = "Cancelled by user";
      }
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg && lastMsg.isStreaming) {
        lastMsg.isStreaming = false;
      }
      this.updateStatus(session, "cancelled");
      this.flushNotify(session);
      await this.persist(session);
    }

    this.cancelHandles.delete(sessionId);
    return true;
  }

  getSession(sessionId: string): AiSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? cloneSession(session) : undefined;
  }

  loadSession(session: AiSession): void {
    this.sessions.set(session.id, session);
  }

  async removeSession(sessionId: string): Promise<void> {
    const cancel = this.cancelHandles.get(sessionId);
    if (cancel) {
      cancel().catch(() => {});
      this.cancelHandles.delete(sessionId);
    }

    // Await active turn with timeout to prevent persist on removed session
    const activeTurn = this.activeTurns.get(sessionId);
    if (activeTurn) {
      await Promise.race([activeTurn, new Promise<void>((r) => setTimeout(r, 3000))]);
      this.activeTurns.delete(sessionId);
    }

    const activeAttach = this.activeAttaches.get(sessionId);
    if (activeAttach) {
      await Promise.race([activeAttach, new Promise<void>((r) => setTimeout(r, 3000))]);
      this.activeAttaches.delete(sessionId);
    }

    const timer = this.pendingNotify.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.pendingNotify.delete(sessionId);
    }

    this.sessions.delete(sessionId);
    this.listeners.delete(sessionId);
  }

  updateModel(sessionId: string, model: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.model = model;
      if (session.contextStatus === "ok" && session.contextUsedTokens != null) {
        const window = getContextWindow(model);
        if (window > 0) {
          session.contextWindowTokens = window;
          session.contextPercentUsed = Math.max(0, Math.min((session.contextUsedTokens / window) * 100, 100));
        }
      }
      session.updatedAt = new Date().toISOString();
      console.log("[OV:engine] updateModel:", sessionId, "model=" + model);
    }
  }

  compactSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages = [];
      session.turns = [];
      session.totalInputTokens = 0;
      session.totalOutputTokens = 0;
      session.contextStatus = "unavailable";
      session.contextUsedTokens = undefined;
      session.contextWindowTokens = undefined;
      session.contextPercentUsed = undefined;
      session.contextSource = undefined;
      session.contextLabel = "Context N/A";
      // Keep conversationId — server-side context is preserved,
      // the next message resumes with full history server-side.
      session.status = "idle";
      session.updatedAt = new Date().toISOString();
      this.flushNotify(session);
      void this.persist(session);
      console.log("[OV:engine] compactSession:", sessionId, "conversationId preserved:", session.conversationId ?? "none");
    }
  }

  async importSession(input: {
    targetId: string;
    workspaceId?: string;
    daemonSessionId?: string;
    tool: ToolName;
    conversationId?: string;
    workingDirectory?: string;
    model?: string;
    daemonOutputOffset?: number;
  }): Promise<AiSession> {
    console.log("[OV:engine] importSession:", input.tool, "daemon=" + (input.daemonSessionId ?? "none"));
    const session: AiSession = {
      id: newId("session"),
      targetId: input.targetId,
      workspaceId: input.workspaceId,
      tool: input.tool,
      status: "idle",
      messages: [],
      turns: [],
      conversationId: input.conversationId,
      workingDirectory: input.workingDirectory,
      model: input.model,
      daemonSessionId: input.daemonSessionId,
      daemonOutputOffset: input.daemonOutputOffset,
      contextStatus: "unavailable",
      contextLabel: "Context N/A",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(session.id, session);
    this.notify(session);
    await this.persist(session);

    console.log("[OV:engine] importSession done:", session.id, "linked to daemon:", input.daemonSessionId ?? "none");
    return cloneSession(session);
  }

  async hydrateSession(
    sessionId: string,
    input: {
      messages: AiMessage[];
      turns: AiTurn[];
      totalInputTokens?: number;
      totalOutputTokens?: number;
      contextStatus?: "ok" | "unavailable";
      contextUsedTokens?: number;
      contextWindowTokens?: number;
      contextPercentUsed?: number;
      contextSource?: "provider" | "derived";
      contextLabel?: string;
      status?: AiSessionStatus;
      daemonOutputOffset?: number;
    },
  ): Promise<AiSession | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.messages = input.messages;
    session.turns = input.turns;
    session.totalInputTokens = input.totalInputTokens ?? 0;
    session.totalOutputTokens = input.totalOutputTokens ?? 0;
    session.contextStatus = input.contextStatus ?? "unavailable";
    session.contextUsedTokens = input.contextUsedTokens;
    session.contextWindowTokens = input.contextWindowTokens;
    session.contextPercentUsed = input.contextPercentUsed;
    session.contextSource = input.contextSource;
    session.contextLabel = input.contextLabel ?? (session.contextStatus === "unavailable" ? "Context N/A" : undefined);
    if (input.status) {
      session.status = input.status;
    }
    if (input.daemonOutputOffset != null) {
      session.daemonOutputOffset = input.daemonOutputOffset;
    }
    session.updatedAt = new Date().toISOString();

    this.flushNotify(session);
    await this.persist(session);
    return cloneSession(session);
  }

  async attachToRunningSession(
    sessionId: string,
    input: {
      target: TargetProfile;
      credentials: SshCredentials;
      retryLimit?: number;
    },
  ): Promise<void> {
    if (this.activeAttaches.has(sessionId)) {
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session?.daemonSessionId) {
      return;
    }

    const retryLimit = input.retryLimit ?? 3;
    const promise = (async () => {
      const current = this.sessions.get(sessionId);
      if (!current?.daemonSessionId) return;

      const adapter = getAdapter(current.tool);
      const parseCtx = adapter.createParseContext?.() ?? {};
      let currentTurnIndex = current.turns.length - 1;
      if (currentTurnIndex < 0) {
        currentTurnIndex = 0;
        current.turns.push({
          index: currentTurnIndex,
          userPrompt: "",
          startedAt: new Date().toISOString(),
        });
      }

      this.updateStatus(current, "running");
      this.flushNotify(current);
      await this.persist(current);

      const signal = { cancelled: false };
      this.cancelHandles.set(sessionId, async () => {
        signal.cancelled = true;
        try {
          await this.transport.cancelTurn(input.target, input.credentials, current.daemonSessionId!);
        } catch {
          // no-op
        }
      });

      let retries = 0;

      while (!signal.cancelled) {
        let turnEnded = false;
        let turnExitCode: number | undefined;
        const offsetBefore = current.daemonOutputOffset ?? 0;

        const newOffset = await this.transport.streamOutput(
          input.target,
          input.credentials,
          current.daemonSessionId,
          offsetBefore,
          (line: DaemonOutputLine) => {
            if (!this.sessions.has(sessionId)) return;

            const lineTs = line.ts ? new Date(line.ts).toISOString() : new Date().toISOString();

            if (line.t === "m" && line.event === "turn_start") {
              const prompt = line.prompt ?? "";
              currentTurnIndex = current.turns.length;
              current.turns.push({
                index: currentTurnIndex,
                userPrompt: prompt,
                startedAt: lineTs,
              });
              if (prompt.trim().length > 0) {
                this.addMessage(current, {
                  id: newId("msg"),
                  role: "user",
                  content: [{ type: "text", text: prompt }],
                  timestamp: lineTs,
                  turnIndex: currentTurnIndex,
                });
              }
              this.updateStatus(current, "running");
              this.notifyThrottled(current);
              return;
            }

            if (line.t === "o" && line.line != null) {
              const trimmed = line.line.trim();
              if (!trimmed) return;
              const events = adapter.parseLine(trimmed, parseCtx);
              for (const event of events) {
                this.processEvent(current, event, currentTurnIndex);
              }
              if (events.length > 0) {
                this.notifyThrottled(current);
              }
              return;
            }

            if (line.t === "e" && line.line != null) {
              const msg = this.getOrCreateAssistantMessage(current, currentTurnIndex);
              msg.content.push({ type: "error", text: line.line });
              this.notifyThrottled(current);
              return;
            }

            if (line.t === "m" && line.event === "turn_end") {
              turnEnded = true;
              turnExitCode = line.exitCode;
              const turn = current.turns[currentTurnIndex];
              if (turn) {
                turn.endedAt = lineTs;
                turn.exitCode = line.exitCode;
              }
              const lastMsg = current.messages[current.messages.length - 1];
              if (lastMsg && lastMsg.role === "assistant" && lastMsg.turnIndex === currentTurnIndex) {
                lastMsg.isStreaming = false;
              }
            }
          },
          signal,
        );

        current.daemonOutputOffset = newOffset;
        if (!this.sessions.has(sessionId)) return;

        let daemonInfo;
        try {
          daemonInfo = await this.transport.getSession(input.target, input.credentials, current.daemonSessionId);
          if (daemonInfo.conversationId && !current.conversationId) {
            current.conversationId = daemonInfo.conversationId;
          }
        } catch {
          daemonInfo = undefined;
        }

        if (turnEnded && turnExitCode != null && turnExitCode !== 0) {
          this.updateStatus(current, "failed");
          const errorMsg = this.getOrCreateAssistantMessage(current, currentTurnIndex);
          errorMsg.content.push({ type: "error", text: `CLI process exited with code ${turnExitCode}` });
          errorMsg.isStreaming = false;
        } else if (daemonInfo?.status !== "running") {
          this.updateStatus(current, "idle");
        } else {
          this.updateStatus(current, "running");
        }

        this.flushNotify(current);
        await this.persist(current);

        if (signal.cancelled) break;
        if (daemonInfo?.status !== "running") break;

        if (newOffset > offsetBefore) {
          retries = 0;
        } else {
          retries += 1;
        }
        if (retries > retryLimit) {
          const msg: AiMessage = {
            id: newId("msg"),
            role: "system",
            content: [{ type: "text", text: "Live attach stream disconnected. Reopen the session to retry streaming." }],
            timestamp: new Date().toISOString(),
            turnIndex: currentTurnIndex,
          };
          this.addMessage(current, msg);
          this.flushNotify(current);
          await this.persist(current);
          break;
        }

        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(500 * retries, 1500)));
      }

      this.cancelHandles.delete(sessionId);
    })().catch((err) => {
      const sessionNow = this.sessions.get(sessionId);
      if (!sessionNow) return;
      const message = err instanceof Error ? err.message : String(err);
      const msg: AiMessage = {
        id: newId("msg"),
        role: "system",
        content: [{ type: "text", text: `Attach stream error: ${message}` }],
        timestamp: new Date().toISOString(),
        turnIndex: Math.max(0, sessionNow.turns.length - 1),
      };
      this.addMessage(sessionNow, msg);
      this.updateStatus(sessionNow, "failed");
      this.flushNotify(sessionNow);
      void this.persist(sessionNow);
    }).finally(() => {
      this.activeAttaches.delete(sessionId);
      this.cancelHandles.delete(sessionId);
    });

    this.activeAttaches.set(sessionId, promise);
  }

  clearSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages = [];
      session.turns = [];
      session.conversationId = undefined;
      session.totalInputTokens = 0;
      session.totalOutputTokens = 0;
      session.contextStatus = "unavailable";
      session.contextUsedTokens = undefined;
      session.contextWindowTokens = undefined;
      session.contextPercentUsed = undefined;
      session.contextSource = undefined;
      session.contextLabel = "Context N/A";
      session.status = "idle";
      session.updatedAt = new Date().toISOString();
      this.flushNotify(session);
      void this.persist(session);
      console.log("[OV:engine] clearSession:", sessionId);
    }
  }

  private async executeTurn(
    session: AiSession,
    target: TargetProfile,
    credentials: SshCredentials,
    prompt: string,
    _allowedTools?: string[],
    autoAccept?: boolean,
  ): Promise<void> {
    console.log("[OV:engine] executeTurn start:", session.id, "tool=" + session.tool, "turn=" + session.turns.length);
    const adapter = getAdapter(session.tool);
    const turnIndex = session.turns.length;
    const parseCtx = adapter.createParseContext?.() ?? {};

    const turn: AiTurn = {
      index: turnIndex,
      userPrompt: prompt,
      startedAt: new Date().toISOString(),
    };
    session.turns.push(turn);

    const userMessage: AiMessage = {
      id: newId("msg"),
      role: "user",
      content: [{ type: "text", text: prompt }],
      timestamp: new Date().toISOString(),
      turnIndex,
    };
    this.addMessage(session, userMessage);
    this.updateStatus(session, "running");
    this.notify(session);
    await this.persist(session);

    const signal = { cancelled: false };

    try {
      // Step 1: Create daemon session if needed
      if (!session.daemonSessionId) {
        console.log("[OV:engine] creating daemon session for", session.tool);
        const { daemonSessionId } = await this.transport.createSession(
          target,
          credentials,
          {
            tool: session.tool,
            cwd: session.workingDirectory ?? "~",
            model: session.model,
            autoAccept,
            conversationId: session.conversationId,
          },
        );
        session.daemonSessionId = daemonSessionId;
        session.daemonOutputOffset = 0;
        console.log("[OV:engine] daemon session created:", daemonSessionId);
        await this.persist(session);
      }

      // Step 2: Send the prompt to the daemon
      console.log("[OV:engine] sending turn to daemon:", session.daemonSessionId);
      try {
        await this.transport.sendTurn(target, credentials, session.daemonSessionId, prompt);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("already running")) {
          throw err;
        }

        // Session is running remotely (e.g. another app view/terminal). Wait, then retry once.
        const note: AiMessage = {
          id: newId("msg"),
          role: "system",
          content: [{ type: "text", text: "Session is already running remotely. Waiting for it to become idle..." }],
          timestamp: new Date().toISOString(),
          turnIndex,
        };
        this.addMessage(session, note);
        this.notify(session);
        await this.persist(session);

        const wait = await this.transport.waitUntilIdle(target, credentials, session.daemonSessionId, 120000);
        if (wait.timedOut) {
          throw new Error("Session is still running remotely. Try again when it becomes idle.");
        }
        await this.transport.sendTurn(target, credentials, session.daemonSessionId, prompt);
      }

      // Step 3: Register cancel handle
      this.cancelHandles.set(session.id, async () => {
        signal.cancelled = true;
        try {
          await this.transport.cancelTurn(target, credentials, session.daemonSessionId!);
        } catch (err) {
          console.warn("[OV:engine] daemon cancel error:", err);
        }
      });

      // Step 4: Stream output from daemon, feed lines to adapter
      let jsonBuffer = "";
      let turnEnded = false;
      let turnExitCode: number | undefined;
      const stderrLines: string[] = [];

      const newOffset = await this.transport.streamOutput(
        target,
        credentials,
        session.daemonSessionId,
        session.daemonOutputOffset ?? 0,
        (line: DaemonOutputLine) => {
          // Guard: session may have been removed mid-turn
          if (!this.sessions.has(session.id)) return;

          if (line.t === "o" && line.line != null) {
            const trimmed = line.line.trim();
            if (trimmed.length === 0) return;

            if (adapter.streaming) {
              const events = adapter.parseLine(trimmed, parseCtx);
              for (const event of events) {
                this.processEvent(session, event, turnIndex);
              }
              if (events.length > 0) {
                this.notifyThrottled(session);
              }
            }
            jsonBuffer += line.line + "\n";
          } else if (line.t === "e" && line.line != null) {
            stderrLines.push(line.line);
            // Surface stderr in the chat UI in real-time
            const msg = this.getOrCreateAssistantMessage(session, turnIndex);
            msg.content.push({ type: "error", text: line.line });
            this.notifyThrottled(session);
          } else if (line.t === "m") {
            if (line.event === "turn_end") {
              turnEnded = true;
              turnExitCode = line.exitCode;
            } else if (line.event === "error") {
              console.warn("[OV:engine] daemon error event:", line.error);
            }
          }
        },
        signal,
      );

      session.daemonOutputOffset = newOffset;
      this.cancelHandles.delete(session.id);

      // Guard: session may have been removed mid-turn
      if (!this.sessions.has(session.id)) return;

      // Step 5: For non-streaming adapters, parse the complete buffer
      if (!adapter.streaming && jsonBuffer.trim().length > 0) {
        const events = adapter.parseComplete(jsonBuffer, parseCtx);
        for (const event of events) {
          this.processEvent(session, event, turnIndex);
        }
      }

      turn.endedAt = new Date().toISOString();
      turn.exitCode = turnExitCode;

      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg && lastMsg.isStreaming) {
        lastMsg.isStreaming = false;
      }

      // Check daemon session for conversationId
      try {
        const daemonInfo = await this.transport.getSession(target, credentials, session.daemonSessionId);
        if (daemonInfo.conversationId && !session.conversationId) {
          session.conversationId = daemonInfo.conversationId;
          console.log("[OV:engine] conversationId from daemon:", daemonInfo.conversationId);
        }
      } catch {
        // Non-critical — conversationId may also be captured by the adapter
      }

      if (turnEnded && (turnExitCode === 0 || turnExitCode == null)) {
        this.updateStatus(session, "idle");
        console.log("[OV:engine] turn completed successfully via daemon, session idle");
      } else if (turnExitCode != null && turnExitCode !== 0) {
        const stderrTail = stderrLines.slice(-10).join("\n").trim();
        const errorText = stderrTail
          ? `CLI process exited with code ${turnExitCode}:\n${stderrTail}`
          : `CLI process exited with code ${turnExitCode}`;
        turn.error = errorText;
        this.updateStatus(session, "failed");
        const errorMsg = this.getOrCreateAssistantMessage(session, turnIndex);
        errorMsg.content.push({
          type: "error",
          text: errorText,
        });
        errorMsg.isStreaming = false;
        console.error("[OV:engine] turn FAILED: exitCode=" + turnExitCode, stderrTail ? "stderr: " + stderrTail.slice(0, 200) : "");
      } else {
        // Stream ended without explicit turn_end (timeout or disconnect)
        this.updateStatus(session, "idle");
        console.log("[OV:engine] turn ended (stream closed), session idle");
      }
    } catch (error) {
      this.cancelHandles.delete(session.id);

      // Guard: session may have been removed mid-turn
      if (!this.sessions.has(session.id)) return;

      const message = error instanceof Error ? error.message : String(error);
      turn.endedAt = new Date().toISOString();
      turn.error = message;

      const errorMsg = this.getOrCreateAssistantMessage(session, turnIndex);
      errorMsg.content.push({ type: "error", text: message });
      errorMsg.isStreaming = false;

      this.updateStatus(session, "failed");
      console.error("[OV:engine] turn EXCEPTION:", message);
    }

    // Guard: session may have been removed mid-turn
    if (!this.sessions.has(session.id)) return;

    console.log("[OV:engine] executeTurn end:", session.id, "status=" + session.status, "messages=" + session.messages.length);
    this.flushNotify(session);
    await this.persist(session);

    // Fire local notifications when app is backgrounded
    if (this.notificationsEnabled && this.appState !== "active") {
      try {
        if (session.status === "idle") {
          await notifySessionComplete(session.id, session.tool);
        } else if (session.status === "failed") {
          const lastError = turn.error ?? "Unknown error";
          await notifySessionFailed(session.id, session.tool, lastError);
        }
      } catch {
        // Notification failures are non-critical
      }
    }
  }
}
