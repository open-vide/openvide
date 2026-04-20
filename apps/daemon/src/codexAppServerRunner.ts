import * as child_process from "node:child_process";
import * as readline from "node:readline";
import { appendOutput } from "./outputStore.js";
import { nowEpoch, log, logError } from "./utils.js";
import type {
  OutputLine,
  PendingPermissionRequest,
  PermissionDecision,
  PermissionMode,
  PermissionRequestStatus,
  SessionRecord,
} from "./types.js";
import type { RunResult, RunningProcess } from "./processRunner.js";

interface JsonRpcPending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type JsonRpcId = string | number;

interface PendingServerPermissionRequest {
  serverRequestId: JsonRpcId;
  method: string;
  params: Record<string, unknown>;
}

type PermissionResponder = (decision: PermissionDecision) => Promise<void>;

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

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringifyCommand(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((part) => typeof part === "string" ? part : String(part))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  return undefined;
}

function extractPatchFiles(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const files = Object.keys(value as Record<string, unknown>).filter(Boolean);
  return files.length > 0 ? files : undefined;
}

function getObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return values.length > 0 ? values : undefined;
}

function grantedPermissionsFromRequest(params: Record<string, unknown>): Record<string, unknown> {
  const requested = getObject(params["permissions"]);
  const granted: Record<string, unknown> = {};
  const network = getObject(requested?.["network"]);
  const fileSystem = getObject(requested?.["fileSystem"]);
  if (network) granted["network"] = network;
  if (fileSystem) granted["fileSystem"] = fileSystem;
  return granted;
}

function permissionStatusForDecision(decision: PermissionDecision): PermissionRequestStatus {
  if (decision === "approve_once") return "approved";
  if (decision === "reject") return "rejected";
  return "cancelled";
}

function commandDecisionFor(decision: PermissionDecision): string {
  if (decision === "approve_once") return "accept";
  if (decision === "reject") return "decline";
  return "cancel";
}

function legacyReviewDecisionFor(decision: PermissionDecision): string {
  if (decision === "approve_once") return "approved";
  if (decision === "reject") return "denied";
  return "abort";
}

function defaultPermissionOptions(): NonNullable<PendingPermissionRequest["options"]> {
  return [
    { id: "approve_once", label: "Approve once", kind: "approve_once" },
    { id: "reject", label: "Reject", kind: "reject" },
    { id: "abort_run", label: "Abort run", kind: "abort_run" },
  ];
}

function isApprovalRequestMethod(method: string): boolean {
  return (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval" ||
    method === "execCommandApproval" ||
    method === "applyPatchApproval"
  );
}

function createPermissionRequest(
  method: string,
  serverRequestId: JsonRpcId,
  params: Record<string, unknown>,
): PendingPermissionRequest | undefined {
  const idParts = [
    method,
    getString(params["threadId"]) ?? getString(params["conversationId"]),
    getString(params["turnId"]),
    getString(params["itemId"]) ?? getString(params["callId"]),
    getString(params["approvalId"]) ?? String(serverRequestId),
  ].filter(Boolean);
  const requestId = idParts.join(":");
  const reason = getString(params["reason"]);

  if (method === "item/commandExecution/requestApproval") {
    const command = stringifyCommand(params["command"]);
    const networkContext = getObject(params["networkApprovalContext"]);
    const networkHost = getString(networkContext?.["host"]);
    return {
      requestId,
      kind: networkContext ? "network" : "command",
      status: "pending",
      title: networkContext ? "Network approval needed" : "Command approval needed",
      description: reason ?? (networkHost
        ? `Codex wants network access to ${networkHost}.`
        : "Codex wants to run a command."),
      command,
      reason,
      risk: networkContext ? "medium" : "low",
      createdAt: new Date().toISOString(),
      source: "codex_app_server",
      backendMethod: method,
    };
  }

  if (method === "execCommandApproval") {
    const command = stringifyCommand(params["command"]);
    return {
      requestId,
      kind: "command",
      status: "pending",
      title: "Command approval needed",
      description: reason ?? "Codex wants to run a command.",
      command,
      reason,
      risk: "low",
      createdAt: new Date().toISOString(),
      source: "codex_app_server",
      backendMethod: method,
    };
  }

  if (method === "item/fileChange/requestApproval") {
    const grantRoot = getString(params["grantRoot"]);
    return {
      requestId,
      kind: "file_write",
      status: "pending",
      title: "File write approval needed",
      description: reason ?? "Codex wants additional write access.",
      files: grantRoot ? [grantRoot] : undefined,
      reason,
      risk: "medium",
      createdAt: new Date().toISOString(),
      source: "codex_app_server",
      backendMethod: method,
    };
  }

  if (method === "item/permissions/requestApproval") {
    const permissions = getObject(params["permissions"]);
    const fileSystem = getObject(permissions?.["fileSystem"]);
    const network = getObject(permissions?.["network"]);
    const files = getStringArray(fileSystem?.["write"]) ?? getStringArray(fileSystem?.["read"]);
    const networkEnabled = network?.["enabled"] === true;
    return {
      requestId,
      kind: networkEnabled ? "network" : files ? "file_write" : "generic",
      status: "pending",
      title: networkEnabled
        ? "Network permission needed"
        : files
          ? "Filesystem permission needed"
          : "Permission needed",
      description: reason ?? "Codex requests additional permissions.",
      files,
      reason,
      risk: networkEnabled || files ? "medium" : "low",
      createdAt: new Date().toISOString(),
      source: "codex_app_server",
      backendMethod: method,
    };
  }

  if (method === "applyPatchApproval") {
    const files = extractPatchFiles(params["fileChanges"]);
    return {
      requestId,
      kind: "file_write",
      status: "pending",
      title: "Patch approval needed",
      description: reason ?? "Codex wants to apply a patch.",
      files,
      reason,
      risk: "medium",
      createdAt: new Date().toISOString(),
      source: "codex_app_server",
      backendMethod: method,
    };
  }

  return undefined;
}

function responseForPermissionDecision(
  method: string,
  params: Record<string, unknown>,
  decision: PermissionDecision,
): Record<string, unknown> {
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return { decision: legacyReviewDecisionFor(decision) };
  }
  if (method === "item/permissions/requestApproval") {
    if (decision !== "approve_once") {
      return { permissions: {}, scope: "turn" };
    }
    return {
      permissions: grantedPermissionsFromRequest(params),
      scope: "turn",
    };
  }
  return { decision: commandDecisionFor(decision) };
}

export function spawnCodexAppServerTurn(
  session: SessionRecord,
  prompt: string,
  turnOpts: { mode?: string; model?: string; permissionMode?: PermissionMode },
  onOutputDelta: (lines: number, bytes: number) => void,
  onPermissionRequest: (request: PendingPermissionRequest, responder: PermissionResponder) => void,
  onPermissionResolved: (requestId: string, status: PermissionRequestStatus) => void,
  onFinished: (result: RunResult) => void,
): RunningProcess {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const resolvedCwd = session.workingDirectory.startsWith("~")
    ? session.workingDirectory.replace("~", home)
    : session.workingDirectory;

  const codexBin = process.env.OPENVIDE_CODEX_BIN ?? "codex";
  const child = child_process.spawn(codexBin, ["app-server", "--listen", "stdio://"], {
    cwd: resolvedCwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: augmentedEnv(),
  });

  const stdoutRl = child.stdout ? readline.createInterface({ input: child.stdout }) : undefined;
  const stderrRl = child.stderr ? readline.createInterface({ input: child.stderr }) : undefined;
  const pending = new Map<JsonRpcId, JsonRpcPending>();
  const pendingServerPermissions = new Map<string, PendingServerPermissionRequest>();
  const streamedAgentMessageIds = new Set<string>();
  let nextId = 1;
  let finished = false;
  let cancelRequested = false;
  let turnStarted = false;
  let threadId = session.conversationId;
  let turnId: string | undefined;
  const askMode = turnOpts.permissionMode === "ask";

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

  const writeResponse = (id: JsonRpcId, result: Record<string, unknown>): void => {
    if (!child.stdin || child.stdin.destroyed) {
      throw new Error("Codex app-server stdin is not available");
    }
    child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  };

  const writeErrorResponse = (id: JsonRpcId, message: string): void => {
    if (!child.stdin || child.stdin.destroyed) return;
    child.stdin.write(`${JSON.stringify({ id, error: { code: -32603, message } })}\n`);
  };

  const clearServerPermissions = (status: PermissionRequestStatus): void => {
    for (const [requestId] of pendingServerPermissions) {
      onPermissionResolved(requestId, status);
      pendingServerPermissions.delete(requestId);
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
    clearServerPermissions(cancelRequested ? "cancelled" : "expired");
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
    if (askMode) {
      emitStderr(`[openvide-daemon] ${reason} Codex Ask mode requires app-server approval support; CLI fallback disabled.`);
      finish({ exitCode: 1, conversationId: threadId }, { writeTurnEnd: false });
      return;
    }
    emitStderr(`[openvide-daemon] ${reason} Retrying with Codex CLI resume.`);
    finish({ exitCode: 1, conversationId: threadId, fallbackToCli: true }, { writeTurnEnd: false });
  };

  const handleServerRequest = (message: Record<string, unknown>, id: JsonRpcId, method: string): void => {
    const params = getObject(message["params"]) ?? {};
    if (!isApprovalRequestMethod(method)) {
      const error = `Unsupported Codex app-server request: ${method}`;
      emitStderr(`[openvide-daemon] ${error}`);
      writeErrorResponse(id, error);
      return;
    }

    const createdRequest = createPermissionRequest(method, id, params);
    if (!createdRequest) {
      const error = `Unsupported Codex approval request payload: ${method}`;
      emitStderr(`[openvide-daemon] ${error}`);
      writeErrorResponse(id, error);
      return;
    }
    const permissionRequest: PendingPermissionRequest = {
      ...createdRequest,
      options: createdRequest.options ?? defaultPermissionOptions(),
    };

    pendingServerPermissions.set(permissionRequest.requestId, {
      serverRequestId: id,
      method,
      params,
    });

    emitStdoutJson({
      type: "permission_request",
      requestId: permissionRequest.requestId,
      kind: permissionRequest.kind,
      status: permissionRequest.status,
      title: permissionRequest.title,
      ...(permissionRequest.description ? { description: permissionRequest.description } : {}),
      ...(permissionRequest.command ? { command: permissionRequest.command } : {}),
      ...(permissionRequest.files ? { files: permissionRequest.files } : {}),
      ...(permissionRequest.reason ? { reason: permissionRequest.reason } : {}),
      ...(permissionRequest.risk ? { risk: permissionRequest.risk } : {}),
      ...(permissionRequest.options ? { options: permissionRequest.options } : {}),
    });

    onPermissionRequest(permissionRequest, async (decision) => {
      const pendingPermission = pendingServerPermissions.get(permissionRequest.requestId);
      if (!pendingPermission) {
        throw new Error(`Permission request ${permissionRequest.requestId} is no longer pending`);
      }

      writeResponse(
        pendingPermission.serverRequestId,
        responseForPermissionDecision(pendingPermission.method, pendingPermission.params, decision),
      );
      pendingServerPermissions.delete(permissionRequest.requestId);
      onPermissionResolved(permissionRequest.requestId, permissionStatusForDecision(decision));

      if (decision === "abort_run" && threadId && turnId) {
        void request("turn/interrupt", { threadId, turnId }).catch(() => {});
      }
    });
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

    if (method === "serverRequest/resolved") {
      const requestId = params["requestId"];
      for (const [pendingRequestId, pendingPermission] of pendingServerPermissions) {
        if (pendingPermission.serverRequestId !== requestId) continue;
        pendingServerPermissions.delete(pendingRequestId);
        onPermissionResolved(pendingRequestId, "expired");
        return;
      }
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
    const messageId = message["id"];
    const messageMethod = typeof message["method"] === "string" ? message["method"] : "";
    if ((typeof messageId === "number" || typeof messageId === "string") && messageMethod) {
      handleServerRequest(message, messageId, messageMethod);
      return;
    }
    if (typeof messageId === "number" || typeof messageId === "string") {
      const pendingRequest = pending.get(messageId);
      if (!pendingRequest) {
        emitStderr(`[openvide-daemon] Unknown Codex app-server response id: ${String(messageId)}`);
        return;
      }
      pending.delete(messageId);
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
          approvalPolicy: askMode ? "on-request" : "never",
          ...(askMode ? { approvalsReviewer: "user", sandbox: "workspace-write" } : {}),
          ...(turnOpts.model ? { model: turnOpts.model } : {}),
        });
        const result = threadStart["result"] as Record<string, unknown> | undefined;
        const thread = result?.["thread"] as Record<string, unknown> | undefined;
        threadId = typeof thread?.["id"] === "string" ? thread["id"] : undefined;
      } else {
        const threadResume = await request("thread/resume", {
          threadId,
          cwd: resolvedCwd,
          approvalPolicy: askMode ? "on-request" : "never",
          ...(askMode ? { approvalsReviewer: "user", sandbox: "workspace-write" } : {}),
          ...(turnOpts.model ? { model: turnOpts.model } : {}),
        });
        const result = threadResume["result"] as Record<string, unknown> | undefined;
        const thread = result?.["thread"] as Record<string, unknown> | undefined;
        const resumedThreadId = typeof thread?.["id"] === "string" ? thread["id"] : undefined;
        if (resumedThreadId) {
          threadId = resumedThreadId;
        }
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
        ...(askMode ? {
          cwd: resolvedCwd,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandboxPolicy: {
            type: "workspaceWrite",
            writableRoots: [resolvedCwd],
            readOnlyAccess: { type: "fullAccess" },
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
        } : {}),
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
