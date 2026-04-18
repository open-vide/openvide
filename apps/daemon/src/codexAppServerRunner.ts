import * as child_process from "node:child_process";
import * as readline from "node:readline";
import { appendOutput } from "./outputStore.js";
import { nowEpoch, log, logError } from "./utils.js";
import type { OutputLine, SessionRecord } from "./types.js";
import type { RunResult, RunningProcess } from "./processRunner.js";

interface JsonRpcPending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

function augmentedEnv(): NodeJS.ProcessEnv {
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
  return {
    ...process.env,
    PATH: [...extraDirs, currentPath].join(":"),
  };
}

function normalizePrompt(prompt: string, mode?: string): string {
  if (mode === "plan") {
    return "You are in PLAN mode. Analyze the codebase and describe what changes you would make, but do NOT apply any changes.\n\n" + prompt;
  }
  return prompt;
}

function parseJson(line: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function normalizeItemType(rawType: string): string {
  return rawType.replace(/^[A-Z]/, (char) => char.toLowerCase());
}

function getItemId(item: Record<string, unknown>): string | undefined {
  return typeof item["id"] === "string" ? item["id"] : undefined;
}

function getItemCallId(item: Record<string, unknown>): string | undefined {
  if (typeof item["call_id"] === "string") return item["call_id"];
  return typeof item["callId"] === "string" ? item["callId"] : undefined;
}

function getTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const typed = block as Record<string, unknown>;
    const text = typeof typed["text"] === "string" ? typed["text"] : "";
    if (text) out.push(text);
  }
  return out.join("\n");
}

function normalizeItemForCli(item: Record<string, unknown>): Record<string, unknown> | undefined {
  const itemType = normalizeItemType(typeof item["type"] === "string" ? item["type"] : "");

  if (itemType === "agentMessage" || itemType === "message") {
    const directText = typeof item["text"] === "string" ? item["text"] : "";
    const contentText = getTextFromContent(item["content"]);
    const text = directText || contentText;
    if (!text.trim() || text.includes("<turn_aborted>")) return undefined;
    return {
      id: getItemId(item),
      type: "agent_message",
      text,
    };
  }

  if (itemType === "reasoning") {
    const directText = typeof item["text"] === "string" ? item["text"] : "";
    const summary = Array.isArray(item["summary"]) ? item["summary"] : [];
    const normalizedSummary = summary
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => {
        const typed = entry as Record<string, unknown>;
        return {
          text: typeof typed["text"] === "string" ? typed["text"] : "",
        };
      })
      .filter((entry) => entry.text.length > 0);
    if (!directText.trim() && normalizedSummary.length === 0) return undefined;
    return {
      id: getItemId(item),
      type: "reasoning",
      ...(directText.trim() ? { text: directText } : {}),
      ...(normalizedSummary.length > 0 ? { summary: normalizedSummary } : {}),
    };
  }

  if (itemType === "functionCall") {
    const args = typeof item["arguments"] === "string" ? item["arguments"] : "";
    return {
      id: getItemId(item),
      type: "function_call",
      name: typeof item["name"] === "string" ? item["name"] : "tool",
      arguments: args,
      ...(getItemCallId(item) ? { call_id: getItemCallId(item) } : {}),
    };
  }

  if (itemType === "functionCallOutput") {
    const output = typeof item["output"] === "string" ? item["output"] : "";
    if (!output.trim()) return undefined;
    return {
      id: getItemId(item),
      type: "function_call_output",
      output,
      ...(getItemCallId(item) ? { call_id: getItemCallId(item) } : {}),
    };
  }

  return undefined;
}

function rpcErrorMessage(message: Record<string, unknown>): string {
  const error = message["error"];
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const typed = error as Record<string, unknown>;
    if (typeof typed["message"] === "string" && typed["message"].trim()) {
      return typed["message"].trim();
    }
  }
  return "Codex app-server request failed";
}

export function spawnCodexAppServerTurn(
  session: SessionRecord,
  prompt: string,
  turnOpts: { mode?: string; model?: string },
  onOutputDelta: (lines: number, bytes: number) => void,
  onFinished: (result: RunResult) => void,
): RunningProcess {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const resolvedCwd = session.workingDirectory.startsWith("~")
    ? session.workingDirectory.replace("~", home)
    : session.workingDirectory;

  const child = child_process.spawn("codex", ["app-server", "--listen", "stdio://"], {
    cwd: resolvedCwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: augmentedEnv(),
  });

  const stdoutRl = child.stdout ? readline.createInterface({ input: child.stdout }) : undefined;
  const stderrRl = child.stderr ? readline.createInterface({ input: child.stderr }) : undefined;
  const pending = new Map<number, JsonRpcPending>();
  const streamedAgentMessageIds = new Set<string>();
  let nextId = 1;
  let finished = false;
  let cancelRequested = false;
  let turnStarted = false;
  let threadId = session.conversationId;
  let turnId: string | undefined;

  const appendEntry = (entry: OutputLine): void => {
    const delta = appendOutput(session.id, entry);
    onOutputDelta(delta.lines, delta.bytes);
  };

  const emitStdoutJson = (payload: Record<string, unknown>): void => {
    appendEntry({ t: "o", ts: nowEpoch(), line: JSON.stringify(payload) });
  };

  const emitStderr = (line: string): void => {
    appendEntry({ t: "e", ts: nowEpoch(), line });
  };

  const emitMeta = (event: "turn_start" | "turn_end" | "error", extra?: { prompt?: string; exitCode?: number; error?: string }): void => {
    appendEntry({
      t: "m",
      ts: nowEpoch(),
      event,
      ...(extra?.prompt ? { prompt: extra.prompt } : {}),
      ...(typeof extra?.exitCode === "number" ? { exitCode: extra.exitCode } : {}),
      ...(extra?.error ? { error: extra.error } : {}),
    });
  };

  const clearPending = (message: string): void => {
    for (const [id, request] of pending) {
      clearTimeout(request.timeout);
      request.reject(new Error(message));
      pending.delete(id);
    }
  };

  const closeReadlines = (): void => {
    try {
      stdoutRl?.close();
    } catch {
      // no-op
    }
    try {
      stderrRl?.close();
    } catch {
      // no-op
    }
  };

  const finish = (result: RunResult, options?: { writeTurnEnd?: boolean }): void => {
    if (finished) return;
    finished = true;
    clearPending("Codex app-server closed");
    closeReadlines();
    if (options?.writeTurnEnd !== false) {
      emitMeta("turn_end", { exitCode: result.exitCode ?? 1 });
    }
    try {
      child.stdin?.end();
    } catch {
      // no-op
    }
    onFinished(result);
  };

  const request = (method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<Record<string, unknown>> =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      if (!child.stdin || child.stdin.destroyed) {
        reject(new Error("Codex app-server stdin is not available"));
        return;
      }
      const id = nextId++;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex app-server ${method} timed out`));
      }, timeoutMs);
      pending.set(id, {
        resolve,
        reject,
        timeout,
      });
      child.stdin.write(`${JSON.stringify({ id, method, params: params ?? {} })}\n`);
    });

  const fallbackToCli = (reason: string): void => {
    emitStderr(`[openvide-daemon] ${reason} Retrying with Codex CLI resume.`);
    finish({ exitCode: 1, conversationId: threadId, fallbackToCli: true }, { writeTurnEnd: false });
  };

  const handleNotification = (message: Record<string, unknown>): void => {
    const method = typeof message["method"] === "string" ? message["method"] : "";
    const params = message["params"] as Record<string, unknown> | undefined;
    if (!method || !params) return;

    if (cancelRequested && threadId && turnId) {
      void request("turn/interrupt", { threadId, turnId }).catch(() => {});
    }

    if (method === "item/started" || method === "item/completed") {
      if (params["threadId"] !== threadId || params["turnId"] !== turnId) return;
      const item = params["item"];
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const normalized = normalizeItemForCli(item as Record<string, unknown>);
      if (!normalized) return;
      const normalizedType = typeof normalized["type"] === "string" ? normalized["type"] : "";
      const normalizedId = typeof normalized["id"] === "string" ? normalized["id"] : undefined;
      if (method === "item/completed" && normalizedType === "agent_message" && normalizedId && streamedAgentMessageIds.has(normalizedId)) {
        return;
      }
      emitStdoutJson({
        type: method === "item/completed" ? "item.completed" : "item.created",
        item: normalized,
      });
      return;
    }

    if (method === "item/agentMessage/delta") {
      if (params["threadId"] !== threadId || params["turnId"] !== turnId) return;
      const delta = typeof params["delta"] === "string" ? params["delta"] : "";
      if (!delta) return;
      const itemId = typeof params["itemId"] === "string" ? params["itemId"] : undefined;
      if (itemId) {
        streamedAgentMessageIds.add(itemId);
      }
      emitStdoutJson({
        type: "item.created",
        item: {
          ...(itemId ? { id: itemId } : {}),
          type: "agent_message",
          text: delta,
        },
      });
      return;
    }

    if (method === "thread/tokenUsage/updated") {
      if (params["threadId"] !== threadId || params["turnId"] !== turnId) return;
      const tokenUsage = params["tokenUsage"] as Record<string, unknown> | undefined;
      const total = tokenUsage?.["total"] as Record<string, unknown> | undefined;
      const inputTokens = typeof total?.["inputTokens"] === "number" ? total["inputTokens"] : undefined;
      const outputTokens = typeof total?.["outputTokens"] === "number" ? total["outputTokens"] : undefined;
      const modelContextWindow =
        typeof tokenUsage?.["modelContextWindow"] === "number" ? tokenUsage["modelContextWindow"] : undefined;
      if (inputTokens == null && outputTokens == null && modelContextWindow == null) return;
      emitStdoutJson({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            ...(modelContextWindow != null ? { model_context_window: modelContextWindow } : {}),
            last_token_usage: {
              ...(inputTokens != null ? { input_tokens: inputTokens } : {}),
              ...(outputTokens != null ? { output_tokens: outputTokens } : {}),
            },
          },
        },
      });
      return;
    }

    if (method === "error") {
      if (params["threadId"] !== threadId || params["turnId"] !== turnId) return;
      if (params["willRetry"] === true) return;
      const error = params["error"] as Record<string, unknown> | undefined;
      const messageText = typeof error?.["message"] === "string"
        ? error["message"]
        : "Codex app-server turn failed.";
      emitStdoutJson({ type: "turn.failed", error: messageText });
      finish({ exitCode: 1, conversationId: threadId });
      return;
    }

    if (method === "turn/completed") {
      if (params["threadId"] !== threadId) return;
      const turn = params["turn"] as Record<string, unknown> | undefined;
      if (!turn || turn["id"] !== turnId) return;
      emitStdoutJson({ type: "turn.completed" });
      const status = typeof turn["status"] === "string" ? turn["status"] : "completed";
      finish({ exitCode: status === "interrupted" ? 130 : 0, conversationId: threadId });
      return;
    }

    if (method === "turn/failed") {
      if (params["threadId"] !== threadId) return;
      const turn = params["turn"] as Record<string, unknown> | undefined;
      if (!turn || turn["id"] !== turnId) return;
      const errorText = typeof turn["error"] === "string" ? turn["error"] : "Codex app-server turn failed.";
      emitStdoutJson({ type: "turn.failed", error: errorText });
      finish({ exitCode: 1, conversationId: threadId });
    }
  };

  emitMeta("turn_start", { prompt });

  stdoutRl?.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const message = parseJson(trimmed);
    if (!message) return;
    if (typeof message["id"] === "number") {
      const pendingRequest = pending.get(message["id"] as number);
      if (!pendingRequest) return;
      pending.delete(message["id"] as number);
      clearTimeout(pendingRequest.timeout);
      if (message["error"]) {
        pendingRequest.reject(new Error(rpcErrorMessage(message)));
      } else {
        pendingRequest.resolve(message);
      }
      return;
    }
    handleNotification(message);
  });

  stderrRl?.on("line", (line) => {
    emitStderr(line);
  });

  child.on("error", (error) => {
    logError(`Codex app-server process error for session ${session.id}:`, error.message);
    emitMeta("error", { error: error.message });
    if (!turnStarted && session.conversationId) {
      fallbackToCli("Codex app-server attach failed before turn start.");
      return;
    }
    finish({ exitCode: 1, conversationId: threadId });
  });

  child.on("close", (code) => {
    if (finished) return;
    const exitCode = code ?? (cancelRequested ? 130 : 1);
    if (!turnStarted && session.conversationId && !cancelRequested) {
      fallbackToCli("Codex app-server exited before the resumed turn started.");
      return;
    }
    finish({ exitCode, conversationId: threadId });
  });

  void (async () => {
    try {
      log(`Spawning Codex app-server for session ${session.id} (${threadId ? "resume" : "new"})`);
      await request("initialize", {
        clientInfo: {
          name: "openvide-daemon",
          version: "0.2.0",
        },
        capabilities: {},
      });
      child.stdin?.write(`${JSON.stringify({ method: "initialized" })}\n`);

      if (!threadId) {
        const threadStart = await request("thread/start", {
          cwd: resolvedCwd,
          approvalPolicy: "never",
          ...(turnOpts.model ? { model: turnOpts.model } : {}),
        });
        const result = threadStart["result"] as Record<string, unknown> | undefined;
        const thread = result?.["thread"] as Record<string, unknown> | undefined;
        threadId = typeof thread?.["id"] === "string" ? thread["id"] : undefined;
      }

      if (!threadId) {
        throw new Error("Codex app-server did not return a thread id.");
      }

      emitStdoutJson({
        type: "thread.started",
        thread_id: threadId,
      });

      const turnStart = await request("turn/start", {
        threadId,
        ...(turnOpts.model ? { model: turnOpts.model } : {}),
        input: [
          {
            type: "text",
            text: normalizePrompt(prompt, turnOpts.mode),
          },
        ],
      });
      const result = turnStart["result"] as Record<string, unknown> | undefined;
      const turn = result?.["turn"] as Record<string, unknown> | undefined;
      turnId = typeof turn?.["id"] === "string" ? turn["id"] : undefined;
      if (!turnId) {
        throw new Error("Codex app-server did not return a turn id.");
      }
      turnStarted = true;
      if (cancelRequested) {
        void request("turn/interrupt", { threadId, turnId }).catch(() => {});
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`Codex app-server runner failed for session ${session.id}:`, message);
      emitMeta("error", { error: message });
      if (!turnStarted && session.conversationId && !cancelRequested) {
        fallbackToCli("Codex app-server could not attach to the resumed thread.");
        return;
      }
      finish({ exitCode: 1, conversationId: threadId });
    }
  })();

  return {
    child,
    get pid() {
      return child.pid;
    },
    kill: (signal: NodeJS.Signals = "SIGINT") => {
      cancelRequested = true;
      if (threadId && turnId) {
        void request("turn/interrupt", { threadId, turnId }).catch(() => {
          if (!child.killed) {
            child.kill(signal);
          }
        });
        return;
      }
      if (!child.killed) {
        child.kill(signal);
      }
    },
  };
}
