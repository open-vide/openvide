import type { CliAdapter, CliStreamEvent } from "../adapterTypes";

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export const claudeAdapter: CliAdapter = {
  tool: "claude",
  streaming: true,

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

  parseLine(jsonLine: string): CliStreamEvent[] {
    const trimmed = jsonLine.trim();
    if (trimmed.length === 0) {
      return [];
    }

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      console.warn("[OV:claude] parseLine: invalid JSON:", trimmed.slice(0, 120));
      return [];
    }

    const events: CliStreamEvent[] = [];
    const type = typeof obj["type"] === "string" ? obj["type"] : undefined;
    console.log("[OV:claude] parseLine: type=" + type);

    if (type === "system") {
      events.push({ type: "message_start", role: "system" });
      return events;
    }

    if (type === "assistant") {
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
          events.push({
            type: "content_block",
            role: "assistant",
            block: { type: "text", text: block["text"] as string },
          });
        } else if (blockType === "thinking") {
          events.push({
            type: "content_block",
            role: "assistant",
            block: { type: "thinking", text: block["thinking"] as string },
          });
        } else if (blockType === "tool_use" || blockType === "server_tool_use") {
          events.push({
            type: "content_block",
            role: "assistant",
            block: {
              type: "tool_use",
              toolName: block["name"] as string,
              toolId: block["id"] as string,
              toolInput: block["input"],
            },
          });
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
          events.push({
            type: "content_block",
            role: "assistant",
            block: {
              type: "tool_result",
              toolId: block["tool_use_id"] as string,
              result: resultText,
              isError,
            },
          });
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

  parseComplete(jsonBlob: string): CliStreamEvent[] {
    const lines = jsonBlob.split("\n");
    const events: CliStreamEvent[] = [];
    for (const line of lines) {
      events.push(...this.parseLine(line));
    }
    return events;
  },
};
