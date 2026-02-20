import { escapeShellArg } from "./utils.js";
import type { Tool, BuildCommandOpts } from "./types.js";

function buildClaudeCommand(opts: BuildCommandOpts): string {
  const parts = [
    "claude",
    "-p", escapeShellArg(opts.prompt),
    "--output-format", "stream-json",
    "--verbose",
  ];
  if (opts.conversationId) {
    parts.push("--resume", escapeShellArg(opts.conversationId));
  }
  if (opts.model) {
    parts.push("--model", escapeShellArg(opts.model));
  }
  if (opts.autoAccept) {
    parts.push("--dangerously-skip-permissions");
  }
  return parts.join(" ");
}

function buildCodexCommand(opts: BuildCommandOpts): string {
  const envPrefix = opts.model ? `OPENAI_MODEL=${escapeShellArg(opts.model)} ` : "";

  if (opts.conversationId) {
    const parts = [
      "codex", "exec", "resume", escapeShellArg(opts.conversationId),
      escapeShellArg(opts.prompt),
      "--json", "--full-auto", "--skip-git-repo-check",
    ];
    return envPrefix + parts.join(" ");
  }

  const parts = [
    "codex", "exec", escapeShellArg(opts.prompt),
    "--json", "--full-auto", "--skip-git-repo-check",
  ];
  return envPrefix + parts.join(" ");
}

function buildGeminiCommand(opts: BuildCommandOpts): string {
  let prompt = opts.prompt;

  // Multi-turn: prepend conversation history
  if (opts.messages && opts.messages.length > 0) {
    const history = opts.messages
      .map((m) => `${m.role}: ${m.text}`)
      .join("\n");
    if (history.length > 0) {
      prompt =
        `<previous_conversation>\n${history}\n</previous_conversation>\n\nContinue the conversation. The user says:\n${opts.prompt}`;
    }
  }

  const parts = [
    "gemini", "-p", escapeShellArg(prompt),
    "--output-format", "json", "-y",
  ];
  if (opts.model) {
    parts.push("--model", escapeShellArg(opts.model));
  }
  return parts.join(" ");
}

export function buildCommand(tool: Tool, opts: BuildCommandOpts): string {
  switch (tool) {
    case "claude":
      return buildClaudeCommand(opts);
    case "codex":
      return buildCodexCommand(opts);
    case "gemini":
      return buildGeminiCommand(opts);
  }
}
