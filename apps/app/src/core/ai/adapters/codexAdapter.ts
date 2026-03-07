import type { CliAdapter, CliStreamEvent } from "../adapterTypes";
import { describeCommandIntent, getCommandIntentKey } from "../commandIntent";
import { sanitizeCodexToolOutput } from "../codexOutputSanitizer";

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function trackPendingSemanticCommand(context: Record<string, unknown> | undefined, key: string | undefined): void {
  if (!context || !key) return;
  const counts = context.pendingSemanticCommands as Record<string, number> | undefined;
  if (!counts) return;
  counts[key] = (counts[key] ?? 0) + 1;
}

function consumePendingSemanticCommand(context: Record<string, unknown> | undefined, key: string | undefined): boolean {
  if (!context || !key) return false;
  const counts = context.pendingSemanticCommands as Record<string, number> | undefined;
  if (!counts) return false;
  const current = counts[key] ?? 0;
  if (current <= 0) return false;
  if (current === 1) {
    delete counts[key];
  } else {
    counts[key] = current - 1;
  }
  return true;
}

export const codexAdapter: CliAdapter = {
  tool: "codex",
  streaming: true,

  buildCommand(input) {
    const envPrefix = input.model ? `OPENAI_MODEL=${escapeShellArg(input.model)} ` : "";

    if (input.conversationId) {
      // Keep exec flags before the resume subcommand for better CLI compatibility.
      const parts = [
        "codex", "exec",
        "--json", "--full-auto", "--skip-git-repo-check",
        "resume", escapeShellArg(input.conversationId),
        "--", escapeShellArg(input.prompt),
      ];
      return envPrefix + parts.join(" ");
    }

    const parts = [
      "codex", "exec", escapeShellArg(input.prompt),
      "--json", "--full-auto", "--skip-git-repo-check",
    ];
    return envPrefix + parts.join(" ");
  },

  createParseContext(): Record<string, unknown> {
    return {
      lastThreadId: undefined,
      pendingSemanticCommands: {},
    };
  },

  parseLine(jsonLine: string, context?: Record<string, unknown>): CliStreamEvent[] {
    const trimmed = jsonLine.trim();
    if (trimmed.length === 0) {
      return [];
    }

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return [];
    }

    const events: CliStreamEvent[] = [];
    const type = typeof obj["type"] === "string" ? obj["type"] : undefined;
    try {
      if (type === "event_msg") {
        const payload = obj["payload"] as Record<string, unknown> | undefined;
        if (!payload) {
          return events;
        }
        const payloadType = typeof payload["type"] === "string" ? payload["type"] : "";
        if (payloadType === "session_configured") {
          const model = typeof payload["model"] === "string" ? payload["model"].trim() : "";
          if (model.length > 0) {
            events.push({
              type: "model",
              model,
            });
          }
          return events;
        }
        if (payloadType === "model_reroute") {
          const toModel = typeof payload["to_model"] === "string"
            ? payload["to_model"].trim()
            : (typeof payload["toModel"] === "string" ? payload["toModel"].trim() : "");
          if (toModel.length > 0) {
            events.push({
              type: "model",
              model: toModel,
            });
          }
          return events;
        }
        if (payloadType !== "token_count") {
          return events;
        }
        const info = payload["info"] as Record<string, unknown> | undefined;
        const lastUsage = info?.["last_token_usage"] as Record<string, unknown> | undefined;
        const contextUsedTokens = typeof lastUsage?.["input_tokens"] === "number"
          ? lastUsage["input_tokens"]
          : undefined;
        const contextWindowTokens = typeof info?.["model_context_window"] === "number"
          ? info["model_context_window"]
          : undefined;
        if (contextUsedTokens != null) {
          events.push({
            type: "usage",
            contextUsedTokens,
            contextWindowTokens,
            contextSource: "provider",
          });
        }
        return events;
      }

      if (type === "thread.started") {
        const threadId = typeof obj["thread_id"] === "string" ? obj["thread_id"] : undefined;
        if (context) {
          context.lastThreadId = threadId;
        }
        events.push({ type: "message_start", role: "assistant" });
        return events;
      }

    if (type === "turn.started") {
      return events;
    }

    if (type === "item.completed" || type === "item.created") {
      const item = obj["item"] as Record<string, unknown> | undefined;
      if (!item) {
        return events;
      }

      const itemType = typeof item["type"] === "string" ? item["type"] : undefined;
      if (!itemType) {
        return events;
      }

      if (itemType === "agent_message" || itemType === "message") {
        // agent_message: text is a direct field
        const directText = typeof item["text"] === "string" ? item["text"] : undefined;
        if (directText) {
          // Skip <turn_aborted> messages — the app handles cancel status separately
          if (directText.includes("<turn_aborted>")) {
            return events;
          }
          events.push({
            type: "content_block",
            role: "assistant",
            block: { type: "text", text: directText },
          });
          return events;
        }

        // Fallback: content array format
        const content = item["content"] as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block["type"] === "string" && (block["type"] === "output_text" || block["type"] === "text")) {
              const text = typeof block["text"] === "string" ? block["text"] : "";
              if (text.includes("<turn_aborted>")) continue;
              events.push({
                type: "content_block",
                role: "assistant",
                block: { type: "text", text },
              });
            }
          }
        }
      } else if (itemType === "reasoning") {
        const text = typeof item["text"] === "string" ? item["text"] : undefined;
        if (text && text.length > 0) {
          events.push({
            type: "content_block",
            role: "assistant",
            block: { type: "thinking", text },
          });
          return events;
        }

        // Fallback: summary array format
        const summary = Array.isArray(item["summary"])
          ? item["summary"] as Array<Record<string, unknown>>
          : undefined;
        const summaryText = summary
          ?.map((s) => (typeof s["text"] === "string" ? s["text"] : ""))
          .join("\n") ?? "";
        if (summaryText.length > 0) {
          events.push({
            type: "content_block",
            role: "assistant",
            block: { type: "thinking", text: summaryText },
          });
        }
      } else if (itemType === "function_call") {
        const name = typeof item["name"] === "string" ? item["name"] : undefined;
        const args = typeof item["arguments"] === "string" ? item["arguments"] : undefined;

        if (name === "shell" || name === "run_command") {
          let command = "";
          try {
            const parsed = JSON.parse(args ?? "{}") as Record<string, unknown>;
            command = (typeof parsed["command"] === "string" ? parsed["command"] : undefined)
              ?? (typeof parsed["cmd"] === "string" ? parsed["cmd"] : undefined)
              ?? args ?? "";
          } catch {
            command = args ?? "";
          }
          const intent = describeCommandIntent(command);
          const intentKey = getCommandIntentKey(intent);
          if (intent.kind === "read" && intent.filePath) {
            trackPendingSemanticCommand(context, intentKey);
            events.push({
              type: "content_block",
              role: "assistant",
              block: {
                type: "tool_use",
                toolName: "Read",
                toolId: typeof item["call_id"] === "string" ? item["call_id"] : undefined,
                toolInput: { file_path: intent.filePath },
              },
            });
          } else if (intent.kind === "search" && intent.pattern) {
            trackPendingSemanticCommand(context, intentKey);
            events.push({
              type: "content_block",
              role: "assistant",
              block: {
                type: "tool_use",
                toolName: "Grep",
                toolId: typeof item["call_id"] === "string" ? item["call_id"] : undefined,
                toolInput: {
                  pattern: intent.pattern,
                  path: intent.path,
                },
              },
            });
          } else if (intent.kind === "list") {
            trackPendingSemanticCommand(context, intentKey);
            events.push({
              type: "content_block",
              role: "assistant",
              block: {
                type: "tool_use",
                toolName: "Glob",
                toolId: typeof item["call_id"] === "string" ? item["call_id"] : undefined,
                toolInput: {
                  path: intent.path,
                },
              },
            });
          } else {
            events.push({
              type: "content_block",
              role: "assistant",
              block: { type: "command_exec", command: intent.command, toolName: name },
            });
          }
        } else if (name === "apply_patch" || name === "apply_diff") {
          // Codex file patching — extract patch content as diff
          let patch = args ?? "";
          let patchFilePath = "";
          try {
            const parsed = JSON.parse(args ?? "{}") as Record<string, unknown>;
            patch = (typeof parsed["patch"] === "string" ? parsed["patch"] : undefined)
              ?? (typeof parsed["diff"] === "string" ? parsed["diff"] : undefined)
              ?? (typeof parsed["content"] === "string" ? parsed["content"] : undefined)
              ?? args ?? "";
            patchFilePath = (typeof parsed["path"] === "string" ? parsed["path"] : undefined)
              ?? (typeof parsed["file_path"] === "string" ? parsed["file_path"] : undefined) ?? "";
          } catch { /* args is the raw patch text */ }
          // Try to extract file path from patch content (e.g. "*** Update File: path/to/file" or "+++ b/path")
          if (!patchFilePath && patch) {
            const updateMatch = /\*\*\*\s+(?:Update|Add|Create)\s+File:\s*(.+)/m.exec(patch);
            const plusMatch = /^\+\+\+ b\/(.+)$/m.exec(patch);
            patchFilePath = updateMatch?.[1]?.trim() ?? plusMatch?.[1]?.trim() ?? "";
          }
          events.push({
            type: "content_block",
            role: "assistant",
            block: { type: "file_change", filePath: patchFilePath, diff: patch },
          });
        } else if (name === "write_file" || name === "create_file") {
          let filePath = "";
          let content = "";
          try {
            const parsed = JSON.parse(args ?? "{}") as Record<string, unknown>;
            filePath = (typeof parsed["path"] === "string" ? parsed["path"] : undefined)
              ?? (typeof parsed["file_path"] === "string" ? parsed["file_path"] : undefined) ?? "";
            content = (typeof parsed["content"] === "string" ? parsed["content"] : undefined)
              ?? (typeof parsed["text"] === "string" ? parsed["text"] : undefined) ?? "";
          } catch { /* */ }
          events.push({
            type: "content_block",
            role: "assistant",
            block: { type: "file_change", filePath, diff: content },
          });
        } else {
          // Parse args for display if JSON
          let parsedInput: unknown = args;
          try {
            parsedInput = JSON.parse(args ?? "{}");
          } catch { /* keep as string */ }
          events.push({
            type: "content_block",
            role: "assistant",
            block: {
              type: "tool_use",
              toolName: name ?? "unknown",
              toolId: typeof item["call_id"] === "string" ? item["call_id"] : undefined,
              toolInput: parsedInput,
            },
          });
        }
      } else if (itemType === "function_call_output") {
        const output = typeof item["output"] === "string" ? item["output"] : undefined;
        const cleanedOutput = sanitizeCodexToolOutput(output ?? "");
        events.push({
          type: "content_block",
          role: "assistant",
          block: {
            type: "tool_result",
            toolId: typeof item["call_id"] === "string" ? item["call_id"] : undefined,
            result: cleanedOutput,
          },
        });
      } else if (itemType === "command_execution" || itemType === "local_shell_call") {
        const command = (typeof item["command"] === "string" ? item["command"] : undefined)
          ?? (typeof item["cmd"] === "string" ? item["cmd"] : undefined) ?? "";
        const rawOutput = (typeof item["output"] === "string" ? item["output"] : undefined)
          ?? (typeof item["stdout"] === "string" ? item["stdout"] : undefined) ?? "";
        const output = sanitizeCodexToolOutput(rawOutput);
        const exitCode = typeof item["exit_code"] === "number" ? item["exit_code"] : undefined;
        const intent = describeCommandIntent(command);
        const intentKey = getCommandIntentKey(intent);
        if (
          (intent.kind === "read" || intent.kind === "search" || intent.kind === "list") &&
          consumePendingSemanticCommand(context, intentKey)
        ) {
          return events;
        }
        events.push({
          type: "content_block",
          role: "assistant",
          block: { type: "command_exec", command: intent.command, output, exitCode },
        });
      } else if (itemType === "file_change") {
        const filePath = (typeof item["file_path"] === "string" ? item["file_path"] : undefined)
          ?? (typeof item["path"] === "string" ? item["path"] : undefined)
          ?? (typeof item["filename"] === "string" ? item["filename"] : undefined) ?? "";
        const diff = (typeof item["diff"] === "string" ? item["diff"] : undefined)
          ?? (typeof item["content"] === "string" ? item["content"] : undefined)
          ?? (typeof item["patch"] === "string" ? item["patch"] : undefined) ?? "";
        events.push({
          type: "content_block",
          role: "assistant",
          block: { type: "file_change", filePath, diff },
        });
      }

      return events;
    }

    const lastThreadId = context ? (context.lastThreadId as string | undefined) : undefined;

    if (type === "turn.failed") {
      const errorMsg = (typeof obj["error"] === "string" ? obj["error"] : undefined)
        ?? (typeof obj["message"] === "string" ? obj["message"] : undefined)
        ?? "Turn failed";
      events.push({
        type: "error",
        block: { type: "error", text: errorMsg },
      });
      events.push({ type: "message_complete", conversationId: lastThreadId });
      return events;
    }

    if (type === "turn.completed") {
      // Include the thread_id captured from thread.started as conversationId
      events.push({ type: "message_complete", conversationId: lastThreadId });
      return events;
    }

      if (type === "error") {
        events.push({
          type: "error",
          block: {
            type: "error",
            text: (typeof obj["message"] === "string" ? obj["message"] : undefined) ?? "Unknown Codex error",
          },
        });
      }

      return events;
    } catch {
      return [];
    }
  },

  parseComplete(jsonBlob: string, context?: Record<string, unknown>): CliStreamEvent[] {
    const lines = jsonBlob.split("\n");
    const events: CliStreamEvent[] = [];
    for (const line of lines) {
      events.push(...this.parseLine(line, context));
    }
    return events;
  },
};
