import type { WorkflowTask } from "./types.js";

export function buildWorkflowPrompt(task: WorkflowTask): string {
  const githubIssue = task.externalLinks.find((link) => link.provider === "github" && link.kind === "issue");
  const notionTask = task.externalLinks.find((link) => link.provider === "notion" && link.kind === "task");

  const lines = [
    "# OpenVide Workflow Session",
    "",
    "You are working inside an OpenVide-managed workflow task.",
    "",
    "## Task",
    task.title,
    "",
    "## Goal",
    task.goal,
    "",
    "## Repository",
    task.repoPath ?? "Unknown",
    "",
    "## GitHub",
    githubIssue?.url ? `Issue: ${githubIssue.url}` : "Issue: none",
    "",
    "## Notion",
    notionTask?.url ? `Task: ${notionTask.url}` : "Task: none",
    "",
    "## Context",
    task.context?.trim() || "No additional context provided.",
    "",
    "## Acceptance Criteria",
    ...task.acceptanceCriteria.map((item) => `- [ ] ${item}`),
    "",
    "## Out Of Scope",
    ...(task.outOfScope.length ? task.outOfScope.map((item) => `- ${item}`) : ["- No unrelated changes"]),
    "",
    "## Operating Rules",
    "- Follow repository instructions such as AGENTS.md, CLAUDE.md, or local docs.",
    "- Keep the change small and coherent.",
    "- Do not change unrelated files.",
    "- Do not print secrets.",
    "- Run available checks before declaring completion.",
    "- If blocked, stop and report the blocker clearly.",
    "",
    "## Completion Contract",
    "When done, report:",
    "- files changed",
    "- checks run",
    "- risks",
    "- suggested PR title/body",
    "- whether GitHub or Notion should be updated",
  ];

  return lines.join("\n");
}
