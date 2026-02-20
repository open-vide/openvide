import type { CliAdapter, CliStreamEvent } from "../adapterTypes";

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export const codexAdapter: CliAdapter = {
  tool: "codex",
  streaming: true,

  buildCommand(input) {
    const envPrefix = input.model ? `OPENAI_MODEL=${escapeShellArg(input.model)} ` : "";

    if (input.conversationId) {
      // Resume an existing conversation
      const parts = [
        "codex", "exec", "resume", escapeShellArg(input.conversationId),
        escapeShellArg(input.prompt),
        "--json", "--full-auto", "--skip-git-repo-check",
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
    return { lastThreadId: undefined };
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
      console.warn("[OV:codex] parseLine: invalid JSON:", trimmed.slice(0, 120));
      return [];
    }

    const events: CliStreamEvent[] = [];
    const type = typeof obj["type"] === "string" ? obj["type"] : undefined;
    console.log("[OV:codex] parseLine: type=" + type);
    try {
      if (type === "event_msg") {
        const payload = obj["payload"] as Record<string, unknown> | undefined;
        if (!payload || payload["type"] !== "token_count") {
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
        if (threadId) {
          console.log("[OV:codex] thread_id captured:", threadId);
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
          events.push({
            type: "content_block",
            role: "assistant",
            block: { type: "command_exec", command, toolName: name },
          });
        } else if (name === "apply_patch" || name === "apply_diff") {
          // Codex file patching — extract patch content as diff
          let patch = args ?? "";
          try {
            const parsed = JSON.parse(args ?? "{}") as Record<string, unknown>;
            patch = (typeof parsed["patch"] === "string" ? parsed["patch"] : undefined)
              ?? (typeof parsed["diff"] === "string" ? parsed["diff"] : undefined)
              ?? (typeof parsed["content"] === "string" ? parsed["content"] : undefined)
              ?? args ?? "";
          } catch { /* args is the raw patch text */ }
          events.push({
            type: "content_block",
            role: "assistant",
            block: { type: "file_change", filePath: "", diff: patch },
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
        events.push({
          type: "content_block",
          role: "assistant",
          block: {
            type: "tool_result",
            toolId: typeof item["call_id"] === "string" ? item["call_id"] : undefined,
            result: output ?? "",
          },
        });
      } else if (itemType === "command_execution" || itemType === "local_shell_call") {
        const command = (typeof item["command"] === "string" ? item["command"] : undefined)
          ?? (typeof item["cmd"] === "string" ? item["cmd"] : undefined) ?? "";
        const output = (typeof item["output"] === "string" ? item["output"] : undefined)
          ?? (typeof item["stdout"] === "string" ? item["stdout"] : undefined) ?? "";
        const exitCode = typeof item["exit_code"] === "number" ? item["exit_code"] : undefined;
        events.push({
          type: "content_block",
          role: "assistant",
          block: { type: "command_exec", command, output, exitCode },
        });
      } else if (itemType === "file_change") {
        const filePath = (typeof item["file_path"] === "string" ? item["file_path"] : undefined)
          ?? (typeof item["path"] === "string" ? item["path"] : undefined) ?? "";
        const diff = (typeof item["diff"] === "string" ? item["diff"] : undefined)
          ?? (typeof item["content"] === "string" ? item["content"] : undefined) ?? "";
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
      const usage = obj["usage"] as Record<string, number> | undefined;
      if (usage) {
        const contextUsedTokens = usage["input_tokens"] ?? usage["total_input_tokens"];
        events.push({
          type: "usage",
          inputTokens: contextUsedTokens,
          outputTokens: usage["output_tokens"] ?? usage["total_output_tokens"],
          contextUsedTokens,
          contextSource: "derived",
        });
      }
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[OV:codex] parseLine unexpected shape:", msg);
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
