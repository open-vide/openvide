import type { AiMessage } from "../../types";
import type { CliAdapter, CliStreamEvent } from "../adapterTypes";

function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function extractTextFromMessages(messages: AiMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const textBlocks = msg.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text as string);
    if (textBlocks.length === 0) {
      continue;
    }
    const role = msg.role === "user" ? "User" : "Assistant";
    parts.push(`[${role}]: ${textBlocks.join("\n")}`);
  }
  return parts.join("\n\n");
}

export const geminiAdapter: CliAdapter = {
  tool: "gemini",
  streaming: false,

  buildCommand(input) {
    let prompt = input.prompt;

    // For multi-turn: prepend conversation history since Gemini CLI
    // doesn't support native conversation resume
    if (input.messages && input.messages.length > 1) {
      const history = extractTextFromMessages(
        input.messages.slice(0, -1), // exclude the current user message
      );
      if (history.length > 0) {
        prompt = `<previous_conversation>\n${history}\n</previous_conversation>\n\nContinue the conversation. The user says:\n${input.prompt}`;
      }
    }

    const parts = ["gemini", "-p", escapeShellArg(prompt), "--output-format", "json", "-y"];
    if (input.model) {
      parts.push("--model", escapeShellArg(input.model));
    }
    return parts.join(" ");
  },

  parseLine(_jsonLine: string): CliStreamEvent[] {
    return [];
  },

  parseComplete(jsonBlob: string): CliStreamEvent[] {
    console.log("[OV:gemini] parseComplete: blob length=" + jsonBlob.length);
    const trimmed = jsonBlob.trim();
    if (trimmed.length === 0) {
      console.warn("[OV:gemini] parseComplete: empty blob");
      return [];
    }

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      console.error("[OV:gemini] parseComplete: invalid JSON:", trimmed.slice(0, 200));
      return [
        {
          type: "error",
          block: { type: "error", text: "Failed to parse Gemini JSON response" },
        },
      ];
    }

    const events: CliStreamEvent[] = [];
    events.push({ type: "message_start", role: "assistant" });
    console.log("[OV:gemini] parseComplete: parsed OK, keys:", Object.keys(obj).join(", "));

    let foundContent = false;

    // Primary: Gemini CLI direct response format { "response": "text here" }
    if (typeof obj["response"] === "string" && (obj["response"] as string).length > 0) {
      events.push({
        type: "content_block",
        role: "assistant",
        block: { type: "text", text: obj["response"] as string },
      });
      foundContent = true;
    }

    // Fallback: API candidates format { response: { candidates: [...] } }
    if (!foundContent) {
      const responseObj = typeof obj["response"] === "object" ? obj["response"] as Record<string, unknown> : undefined;
      const candidates = (responseObj?.["candidates"] ?? obj["candidates"]) as
        | Array<Record<string, unknown>>
        | undefined;

      if (Array.isArray(candidates)) {
        for (const candidate of candidates) {
          if (typeof candidate !== "object" || candidate === null) continue;
          const content = candidate["content"] as Record<string, unknown> | undefined;
          if (typeof content !== "object" || content === null) continue;
          const parts = content["parts"] as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (typeof part !== "object" || part === null) continue;
              if (typeof part["text"] === "string") {
                events.push({
                  type: "content_block",
                  role: "assistant",
                  block: { type: "text", text: part["text"] as string },
                });
                foundContent = true;
              }
            }
          }
        }
      }
    }

    // Fallback: direct text field
    if (!foundContent && typeof obj["text"] === "string") {
      events.push({
        type: "content_block",
        role: "assistant",
        block: { type: "text", text: obj["text"] as string },
      });
    }

    // Error handling
    if (typeof obj["error"] === "string" && (obj["error"] as string).length > 0) {
      events.push({
        type: "error",
        block: { type: "error", text: obj["error"] as string },
      });
    }

    // Usage metadata
    const responseForUsage = typeof obj["response"] === "object" ? obj["response"] as Record<string, unknown> : undefined;
    const usageMetadata = (responseForUsage?.["usageMetadata"] ?? obj["usageMetadata"] ?? obj["stats"]) as
      | Record<string, number>
      | undefined;
    if (usageMetadata) {
      events.push({
        type: "usage",
        inputTokens: usageMetadata["promptTokenCount"] ?? usageMetadata["input_tokens"],
        outputTokens: usageMetadata["candidatesTokenCount"] ?? usageMetadata["totalTokenCount"] ?? usageMetadata["output_tokens"],
      });
    }

    events.push({ type: "message_complete" });
    return events;
  },
};
