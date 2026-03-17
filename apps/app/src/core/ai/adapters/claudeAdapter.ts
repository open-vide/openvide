import type { CliAdapter, CliStreamEvent } from "../adapterTypes";
import { sanitizeCodexToolOutput } from "../codexOutputSanitizer";

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function isSubagentTool(name: string): boolean {
  return name === "Agent" || name === "dispatch_agent";
}

export const claudeAdapter: CliAdapter = {
  tool: "claude",
  streaming: true,

  createParseContext(): Record<string, unknown> {
    return {
      // Set of tool_use IDs that are Agent/subagent calls
      agentToolIds: new Set<string>(),
    };
  },

  buildCommand(input) {
    const parts = ["claude", "-p", escapeShellArg(input.prompt), "--output-format", "stream-json", "--verbose"];
    if (input.conversationId) {
      parts.push("--resume", escapeShellArg(input.conversationId));
    }
    if (input.allowedTools && input.allowedTools.length > 0) {
      parts.push("--allowedTools", input.allowedTools.map(escapeShellArg).join(","));
    }
    if (input.model) {
      parts.push("--model", escapeShellArg(input.model));
    }
    // Always skip permissions — daemon is non-interactive
    parts.push("--dangerously-skip-permissions");
    return parts.join(" ");
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

    if (type === "system") {
      events.push({ type: "message_start", role: "system" });
      return events;
    }

    if (type === "assistant" || type === "user") {
      const message = obj["message"] as Record<string, unknown> | undefined;
      if (!message) {
        return events;
      }

      const content = message["content"] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) {
        return events;
      }

      for (const block of content) {
        const blockType = typeof block["type"] === "string" ? block["type"] : undefined;
        if (!blockType) continue;

        if (blockType === "text") {
          // Only emit text blocks from assistant messages
          if (type === "assistant") {
            events.push({
              type: "content_block",
              role: "assistant",
              block: { type: "text", text: block["text"] as string },
            });
          }
        } else if (blockType === "thinking") {
          events.push({
            type: "content_block",
            role: "assistant",
            block: { type: "thinking", text: block["thinking"] as string },
          });
        } else if (blockType === "tool_use" || blockType === "server_tool_use") {
          const toolName = block["name"] as string;
          const toolId = block["id"] as string;
          const toolInput = block["input"] as Record<string, unknown> | undefined;

          if (isSubagentTool(toolName) && toolId) {
            const agentIds = context?.agentToolIds as Set<string> | undefined;
            agentIds?.add(toolId);
            const description = typeof toolInput?.["description"] === "string"
              ? toolInput["description"]
              : "";
            const prompt = typeof toolInput?.["prompt"] === "string"
              ? toolInput["prompt"]
              : "";
            events.push({
              type: "content_block",
              role: "assistant",
              block: {
                type: "subagent",
                subagentId: toolId,
                subagentName: description || "Agent",
                subagentPrompt: prompt,
                subagentStatus: "running",
              },
            });
          } else {
            events.push({
              type: "content_block",
              role: "assistant",
              block: {
                type: "tool_use",
                toolName,
                toolId,
                toolInput,
              },
            });
          }
        } else if (blockType === "web_search_tool_result") {
          const searchResults: Array<{ title: string; url: string; snippet: string }> = [];
          const content = block["content"] as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(content)) {
            for (const entry of content) {
              if (entry["type"] === "web_search_result") {
                searchResults.push({
                  title: (entry["title"] as string) ?? "",
                  url: (entry["url"] as string) ?? "",
                  snippet: (entry["snippet"] as string) ?? (entry["text"] as string) ?? "",
                });
              }
            }
          }
          events.push({
            type: "content_block",
            role: "assistant",
            block: {
              type: "web_search",
              searchQuery: (block["query"] as string) ?? (block["name"] as string) ?? "Web search",
              searchResults,
            },
          });
        } else if (blockType === "tool_result") {
          const isError = block["is_error"] === true;
          const toolUseId = block["tool_use_id"] as string;
          let resultText = "";
          const resultContent = block["content"];
          if (typeof resultContent === "string") {
            resultText = resultContent;
          } else if (Array.isArray(resultContent)) {
            resultText = (resultContent as Array<Record<string, unknown>>)
              .filter((c) => c["type"] === "text")
              .map((c) => c["text"] as string)
              .join("\n");
          }
          resultText = sanitizeCodexToolOutput(resultText);

          const agentIds = context?.agentToolIds as Set<string> | undefined;
          if (agentIds?.has(toolUseId)) {
            events.push({
              type: "content_block",
              role: "assistant",
              block: {
                type: "subagent",
                subagentId: toolUseId,
                subagentResult: resultText,
                subagentStatus: isError ? "failed" : "completed",
              },
            });
          } else {
            events.push({
              type: "content_block",
              role: "assistant",
              block: {
                type: "tool_result",
                toolId: toolUseId,
                result: resultText,
                isError,
              },
            });
          }
        }
      }
      return events;
    }

    if (type === "result") {
      const sessionId = obj["session_id"] as string | undefined;
      const usage = obj["usage"] as Record<string, number> | undefined;

      if (usage) {
        const contextUsedTokens = usage["input_tokens"];
        events.push({
          type: "usage",
          inputTokens: usage["input_tokens"],
          outputTokens: usage["output_tokens"],
          contextUsedTokens,
          contextSource: "derived",
        });
      }

      events.push({
        type: "message_complete",
        conversationId: sessionId,
      });
      return events;
    }

    if (type === "error") {
      events.push({
        type: "error",
        block: {
          type: "error",
          text: (obj["error"] as Record<string, string> | undefined)?.["message"] ?? "Unknown error",
        },
      });
    }

    return events;
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
