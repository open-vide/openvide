import type { AiMessage, AiSessionStatus } from "../types";

const REQUEST_USER_INPUT_TOOL_NAMES = new Set([
  "askuserquestion",
  "request_user_input",
  "requestuserinput",
]);

const UPDATE_PLAN_TOOL_NAMES = new Set([
  "update_plan",
  "updateplan",
]);

const ENTER_PLAN_MODE_TOOL_NAMES = new Set([
  "enterplanmode",
  "enter_plan_mode",
]);

const EXIT_PLAN_MODE_TOOL_NAMES = new Set([
  "exitplanmode",
  "exit_plan_mode",
]);

function normalizeToolName(name?: string): string {
  return (name ?? "").trim().toLowerCase();
}

export function isRequestUserInputToolName(name?: string): boolean {
  return REQUEST_USER_INPUT_TOOL_NAMES.has(normalizeToolName(name));
}

export function isUpdatePlanToolName(name?: string): boolean {
  return UPDATE_PLAN_TOOL_NAMES.has(normalizeToolName(name));
}

export function isEnterPlanModeToolName(name?: string): boolean {
  return ENTER_PLAN_MODE_TOOL_NAMES.has(normalizeToolName(name));
}

export function isExitPlanModeToolName(name?: string): boolean {
  return EXIT_PLAN_MODE_TOOL_NAMES.has(normalizeToolName(name));
}

export function shouldAutoCompleteToolUse(name?: string): boolean {
  return (
    isUpdatePlanToolName(name) ||
    isEnterPlanModeToolName(name) ||
    isExitPlanModeToolName(name)
  );
}

export function hasPendingUserInputRequest(messages: AiMessage[]): boolean {
  let lastQuestionIndex = -1;
  let lastUserIndex = -1;

  messages.forEach((message, index) => {
    if (message.role === "user") {
      lastUserIndex = index;
      return;
    }

    if (message.role !== "assistant") {
      return;
    }

    const hasQuestion = message.content.some(
      (block) => block.type === "tool_use" && isRequestUserInputToolName(block.toolName),
    );
    if (hasQuestion) {
      lastQuestionIndex = index;
    }
  });

  return lastQuestionIndex >= 0 && lastQuestionIndex > lastUserIndex;
}

export function deriveHydratedSessionStatus(
  fallbackStatus: AiSessionStatus,
  messages: AiMessage[],
): AiSessionStatus {
  if (
    fallbackStatus === "running" ||
    fallbackStatus === "failed" ||
    fallbackStatus === "cancelled"
  ) {
    return fallbackStatus;
  }

  if (hasPendingUserInputRequest(messages)) {
    return "awaiting_input";
  }

  if (fallbackStatus === "awaiting_input") {
    return "idle";
  }

  return fallbackStatus;
}
