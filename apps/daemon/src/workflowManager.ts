import * as fs from "node:fs";
import * as path from "node:path";
import { daemonDir, newId, nowISO, log } from "./utils.js";
import * as sm from "./sessionManager.js";
import { buildWorkflowPrompt } from "./workflowPrompts.js";
import {
  closeGithubIssue,
  commentOnGithubIssue,
  createGithubIssue,
  createGithubPullRequest,
  detectGithubRepo,
  getGitSummary,
  listGithubIssues,
  listGithubPullRequests,
} from "./integrations/github.js";
import {
  appendNotionPage,
  createNotionBriefing,
  createNotionTask,
} from "./integrations/notion.js";
import type {
  DaemonState,
  IpcResponse,
  SessionRecord,
  Tool,
  WorkflowBriefing,
  WorkflowConfig,
  WorkflowDecision,
  WorkflowEvent,
  WorkflowExternalKind,
  WorkflowExternalLink,
  WorkflowExternalProvider,
  WorkflowPriority,
  WorkflowProject,
  WorkflowPullRequestDraft,
  WorkflowTask,
  WorkflowTaskStatus,
} from "./types.js";

type ProjectInput = {
  name: string;
  path: string;
  github?: string;
  priority?: WorkflowPriority;
  type?: string;
};

type CreateTaskInput = {
  project: string;
  title: string;
  tool?: Tool;
  createGithubIssue?: boolean;
};

type SyncResult = { target: string; ok: boolean; message?: string; error?: string };

let hooksInitialized = false;

export function initWorkflowHooks(): void {
  if (hooksInitialized) return;
  hooksInitialized = true;
  sm.registerSessionLifecycleListener((event) => {
    if (!event.session.workflowTaskId) return;
    handleSessionLifecycle(event.session);
  });
}

function workflowState(): DaemonState {
  const state = sm.getState();
  state.workflowProjects ??= {};
  state.workflowTasks ??= {};
  state.workflowDecisions ??= {};
  state.workflowBriefings ??= {};
  state.workflowEvents ??= [];
  return state;
}

function persist(): void {
  sm.persist();
}

function expandHome(input: string): string {
  if (input === "~") return process.env.HOME ?? process.env.USERPROFILE ?? input;
  if (input.startsWith("~/")) {
    return path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", input.slice(2));
  }
  return input;
}

function resolvePath(input: string): string {
  return path.resolve(expandHome(input));
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "item";
}

function event(type: string, entityType: WorkflowEvent["entityType"], entityId: string, message: string): void {
  const state = workflowState();
  state.workflowEvents!.push({
    id: newId("wev"),
    type,
    entityType,
    entityId,
    message,
    createdAt: nowISO(),
  });
  if (state.workflowEvents!.length > 500) {
    state.workflowEvents = state.workflowEvents!.slice(-500);
  }
}

function projects(): Record<string, WorkflowProject> {
  return workflowState().workflowProjects!;
}

function tasks(): Record<string, WorkflowTask> {
  return workflowState().workflowTasks!;
}

function decisions(): Record<string, WorkflowDecision> {
  return workflowState().workflowDecisions!;
}

function briefings(): Record<string, WorkflowBriefing> {
  return workflowState().workflowBriefings!;
}

export function getWorkflowConfig(): WorkflowConfig {
  return workflowState().workflowConfig ?? {};
}

export function updateWorkflowConfig(input: {
  workspaceRoot?: string;
  githubEnabled?: boolean;
  githubDefaultOwner?: string;
  githubAutoCreateIssues?: boolean;
  notionEnabled?: boolean;
  notionTasksDatabaseId?: string;
  notionBriefingsDatabaseId?: string;
  notionDecisionsDatabaseId?: string;
  notionSessionsDatabaseId?: string;
}): WorkflowConfig {
  const state = workflowState();
  const current = state.workflowConfig ?? {};
  const next: WorkflowConfig = {
    ...current,
    github: { ...(current.github ?? {}) },
    notion: { ...(current.notion ?? {}) },
  };

  if (input.workspaceRoot !== undefined) next.workspaceRoot = input.workspaceRoot;
  if (input.githubEnabled !== undefined) next.github!.enabled = input.githubEnabled;
  if (input.githubDefaultOwner !== undefined) next.github!.defaultOwner = input.githubDefaultOwner;
  if (input.githubAutoCreateIssues !== undefined) next.github!.autoCreateIssues = input.githubAutoCreateIssues;
  if (input.notionEnabled !== undefined) next.notion!.enabled = input.notionEnabled;
  if (input.notionTasksDatabaseId !== undefined) next.notion!.tasksDatabaseId = input.notionTasksDatabaseId;
  if (input.notionBriefingsDatabaseId !== undefined) next.notion!.briefingsDatabaseId = input.notionBriefingsDatabaseId;
  if (input.notionDecisionsDatabaseId !== undefined) next.notion!.decisionsDatabaseId = input.notionDecisionsDatabaseId;
  if (input.notionSessionsDatabaseId !== undefined) next.notion!.sessionsDatabaseId = input.notionSessionsDatabaseId;

  state.workflowConfig = next;
  event("workflow.config.updated", "integration", "workflow", "Workflow config updated");
  persist();
  return next;
}

export function listProjects(): WorkflowProject[] {
  return Object.values(projects()).sort((left, right) => left.name.localeCompare(right.name));
}

export async function addProject(input: ProjectInput): Promise<WorkflowProject> {
  const now = nowISO();
  const id = slug(input.name);
  const resolvedPath = resolvePath(input.path);
  const existing = projects()[id];
  const github = input.github ?? existing?.github ?? await detectGithubRepo(resolvedPath);
  const project: WorkflowProject = {
    id,
    name: input.name,
    path: resolvedPath,
    github,
    priority: input.priority ?? existing?.priority ?? "medium",
    type: input.type ?? existing?.type,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  projects()[id] = project;
  event(existing ? "project.updated" : "project.created", "project", project.id, `Project ${project.name} saved`);
  persist();
  return project;
}

export async function scanProjects(root: string, save: boolean): Promise<WorkflowProject[]> {
  const resolvedRoot = resolvePath(root);
  const found: WorkflowProject[] = [];
  const skip = new Set([".git", "node_modules", "dist", "build", ".turbo", ".expo", "ios", "android"]);

  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.name === ".git")) {
      const name = path.basename(dir);
      const github = await detectGithubRepo(dir);
      const project: WorkflowProject = {
        id: slug(name),
        name,
        path: dir,
        github,
        priority: "medium",
        createdAt: nowISO(),
        updatedAt: nowISO(),
      };
      found.push(project);
      if (save) {
        await addProject({
          name,
          path: dir,
          github,
          priority: "medium",
        });
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name)) continue;
      await visit(path.join(dir, entry.name), depth + 1);
    }
  }

  await visit(resolvedRoot, 0);
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

function findProject(projectRef: string): WorkflowProject | undefined {
  const normalized = slug(projectRef);
  return projects()[normalized]
    ?? Object.values(projects()).find((project) => project.name === projectRef || project.path === resolvePath(projectRef));
}

function requireProject(projectRef: string): WorkflowProject {
  const project = findProject(projectRef);
  if (!project) throw new Error(`Project not found: ${projectRef}`);
  return project;
}

function pendingLink(provider: WorkflowExternalProvider, kind: WorkflowExternalKind): WorkflowExternalLink {
  return {
    provider,
    kind,
    status: "pending",
    updatedAt: nowISO(),
  };
}

function findLink(
  links: WorkflowExternalLink[],
  provider: WorkflowExternalProvider,
  kind: WorkflowExternalKind,
): WorkflowExternalLink | undefined {
  return links.find((link) => link.provider === provider && link.kind === kind);
}

function addOrReplaceLink(
  links: WorkflowExternalLink[],
  next: WorkflowExternalLink,
): WorkflowExternalLink[] {
  const index = links.findIndex((link) => link.provider === next.provider && link.kind === next.kind);
  if (index === -1) return [...links, next];
  const copy = [...links];
  copy[index] = next;
  return copy;
}

function shouldSyncNotion(): boolean {
  const config = getWorkflowConfig();
  return config.notion?.enabled === true;
}

function shouldCreateGithubIssue(explicit: boolean | undefined): boolean {
  const config = getWorkflowConfig();
  if (explicit !== undefined) return explicit;
  return config.github?.autoCreateIssues === true;
}

function taskMarkdown(task: WorkflowTask): string {
  return [
    `## Goal`,
    task.goal,
    "",
    `## Context`,
    task.context || "Created from OpenVide workflow.",
    "",
    `## Acceptance Criteria`,
    ...task.acceptanceCriteria.map((item) => `- [ ] ${item}`),
    "",
    `## Out Of Scope`,
    ...(task.outOfScope.length ? task.outOfScope.map((item) => `- ${item}`) : ["- No unrelated changes"]),
  ].join("\n");
}

export async function createWorkflowTask(input: CreateTaskInput): Promise<WorkflowTask> {
  const project = requireProject(input.project);
  const now = nowISO();
  const githubRepo = project.github ?? await detectGithubRepo(project.path);
  let task: WorkflowTask = {
    id: newId("task"),
    title: input.title.trim(),
    goal: input.title.trim(),
    context: "Created from OpenVide workflow.",
    projectId: project.id,
    repoPath: project.path,
    githubRepo,
    status: "ready",
    source: "manual",
    tool: input.tool ?? "codex",
    sessionIds: [],
    externalLinks: [],
    acceptanceCriteria: ["Checks pass", "Small coherent change", "No unrelated changes"],
    outOfScope: ["Unrelated refactors", "Secrets or credential changes"],
    createdAt: now,
    updatedAt: now,
  };

  if (shouldCreateGithubIssue(input.createGithubIssue) && githubRepo) {
    task.externalLinks = addOrReplaceLink(task.externalLinks, pendingLink("github", "issue"));
  }
  if (shouldSyncNotion() && getWorkflowConfig().notion?.tasksDatabaseId) {
    task.externalLinks = addOrReplaceLink(task.externalLinks, pendingLink("notion", "task"));
  }

  tasks()[task.id] = task;
  event("task.created", "task", task.id, `Task created: ${task.title}`);
  persist();

  task = await syncTask(task.id, false);
  return task;
}

export function getWorkflowTask(id: string): WorkflowTask | undefined {
  return tasks()[id];
}

function requireTask(id: string): WorkflowTask {
  const task = getWorkflowTask(id);
  if (!task) throw new Error(`Task not found: ${id}`);
  return task;
}

export function listWorkflowTasks(): WorkflowTask[] {
  return Object.values(tasks()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function saveTask(task: WorkflowTask): WorkflowTask {
  tasks()[task.id] = { ...task, updatedAt: nowISO() };
  persist();
  return tasks()[task.id]!;
}

export async function startWorkflowTask(input: {
  id: string;
  tool?: Tool;
  prepare?: boolean;
}): Promise<{ task: WorkflowTask; session?: SessionRecord; prompt: string }> {
  let task = requireTask(input.id);
  const tool = input.tool ?? task.tool;
  task = saveTask({ ...task, tool });
  const prompt = buildWorkflowPrompt(task);

  if (input.prepare) {
    event("task.prompt.prepared", "task", task.id, `Prepared prompt for ${task.title}`);
    return { task, prompt };
  }

  if (!task.repoPath) throw new Error(`Task ${task.id} does not have a repo path`);
  const session = sm.createSession(
    tool,
    task.repoPath,
    undefined,
    true,
    undefined,
    {
      workflowTaskId: task.id,
      workflowTaskTitle: task.title,
    },
  );

  task = saveTask({
    ...task,
    status: "running",
    sessionIds: Array.from(new Set([...task.sessionIds, session.id])),
  });

  const sendRes = sm.sendTurn(session.id, prompt);
  if (!sendRes.ok) {
    task = saveTask({ ...task, status: "blocked" });
    event("task.session.failed", "task", task.id, sendRes.error ?? "Failed to start workflow session");
    throw new Error(sendRes.error ?? "Failed to start workflow session");
  }

  event("task.session.started", "task", task.id, `Started ${tool} session ${session.id}`);
  return { task, session: sendRes.session ?? session, prompt };
}

export async function createAndStartWorkflowTask(input: {
  project: string;
  title: string;
  tool: Tool;
}): Promise<{ task: WorkflowTask; session?: SessionRecord; prompt: string }> {
  const task = await createWorkflowTask({
    project: input.project,
    title: input.title,
    tool: input.tool,
  });
  return startWorkflowTask({ id: task.id, tool: input.tool });
}

export function attachWorkflowTask(input: {
  taskId: string;
  sessionId: string;
}): WorkflowTask {
  const task = requireTask(input.taskId);
  const session = sm.updateSession(input.sessionId, {
    workflowTaskId: task.id,
    workflowTaskTitle: task.title,
  });
  if (!session) throw new Error(`Session not found: ${input.sessionId}`);
  const next = saveTask({
    ...task,
    sessionIds: Array.from(new Set([...task.sessionIds, input.sessionId])),
  });
  event("task.session.attached", "task", task.id, `Attached session ${input.sessionId}`);
  return next;
}

export function attachNativeWorkflowTask(input: {
  taskId: string;
  tool: "codex" | "claude";
  resumeId: string;
  cwd: string;
  sendContext?: boolean;
}): { task: WorkflowTask; session: SessionRecord; prompt: string } {
  let task = requireTask(input.taskId);
  const prompt = buildWorkflowPrompt(task);
  const session = sm.createSession(
    input.tool,
    resolvePath(input.cwd),
    undefined,
    true,
    input.resumeId,
    {
      workflowTaskId: task.id,
      workflowTaskTitle: task.title,
    },
  );
  task = saveTask({
    ...task,
    sessionIds: Array.from(new Set([...task.sessionIds, session.id, `${input.tool}:${input.resumeId}`])),
  });
  event("task.native.attached", "task", task.id, `Attached native ${input.tool} session ${input.resumeId}`);

  if (input.sendContext) {
    const sendRes = sm.sendTurn(session.id, prompt);
    if (!sendRes.ok) throw new Error(sendRes.error ?? "Failed to send workflow context");
  }

  return { task, session, prompt };
}

export async function importNativeWorkflowTask(input: {
  project: string;
  tool: "codex" | "claude";
  resumeId: string;
  title: string;
  cwd: string;
}): Promise<{ task: WorkflowTask; session: SessionRecord; prompt: string }> {
  const task = await createWorkflowTask({
    project: input.project,
    title: input.title,
    tool: input.tool,
  });
  return attachNativeWorkflowTask({
    taskId: task.id,
    tool: input.tool,
    resumeId: input.resumeId,
    cwd: input.cwd,
  });
}

export async function completeWorkflowTask(input: {
  id: string;
  summary?: string;
  closeIssue?: boolean;
}): Promise<WorkflowTask> {
  let task = requireTask(input.id);
  task = saveTask({
    ...task,
    status: "done",
    completedAt: nowISO(),
    summary: input.summary ?? task.summary ?? "Completed from OpenVide workflow.",
  });
  event("task.completed", "task", task.id, `Task completed: ${task.title}`);

  const issue = findLink(task.externalLinks, "github", "issue");
  if (issue?.url || issue?.number) {
    const issueRef = issue.url ?? String(issue.number);
    const body = [
      "OpenVide workflow task completed.",
      "",
      task.summary ?? "",
    ].join("\n").trim();
    try {
      if (input.closeIssue) {
        await closeGithubIssue({ issueUrlOrNumber: issueRef, repo: task.githubRepo, comment: body });
      } else {
        await commentOnGithubIssue({ issueUrlOrNumber: issueRef, repo: task.githubRepo, body });
      }
    } catch (err) {
      task.externalLinks = addOrReplaceLink(task.externalLinks, {
        ...issue,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: nowISO(),
      });
      task = saveTask(task);
    }
  }

  const notion = findLink(task.externalLinks, "notion", "task");
  if (notion?.id) {
    try {
      await appendNotionPage({
        pageId: notion.id,
        markdown: `OpenVide task completed.\n\n${task.summary ?? ""}`,
      });
    } catch (err) {
      task.externalLinks = addOrReplaceLink(task.externalLinks, {
        ...notion,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        updatedAt: nowISO(),
      });
      task = saveTask(task);
    }
  }

  return task;
}

export function blockWorkflowTask(input: {
  id: string;
  reason: string;
}): WorkflowTask {
  const task = requireTask(input.id);
  const next = saveTask({
    ...task,
    status: "blocked",
    summary: input.reason,
  });
  event("task.blocked", "task", task.id, input.reason);
  return next;
}

function handleSessionLifecycle(session: SessionRecord): void {
  if (!session.workflowTaskId) return;
  const task = tasks()[session.workflowTaskId];
  if (!task || task.status === "done") return;

  if (session.status === "idle" && task.status === "running") {
    saveTask({ ...task, status: "needs-review" });
    event("task.needs_review", "task", task.id, `Session ${session.id} finished successfully`);
    return;
  }

  if ((session.status === "failed" || session.status === "interrupted" || session.status === "cancelled") && task.status === "running") {
    saveTask({
      ...task,
      status: "blocked",
      summary: session.lastTurn?.error ?? `Session ended in ${session.status}`,
    });
    event("task.blocked", "task", task.id, `Session ${session.id} ended in ${session.status}`);
  }
}

async function syncTask(taskId: string, dryRun: boolean): Promise<WorkflowTask> {
  let task = requireTask(taskId);
  const nextLinks: WorkflowExternalLink[] = [];

  for (const link of task.externalLinks) {
    if (link.status === "synced") {
      nextLinks.push(link);
      continue;
    }

    if (dryRun) {
      nextLinks.push(link);
      continue;
    }

    if (link.provider === "github" && link.kind === "issue") {
      if (!task.githubRepo) {
        nextLinks.push({ ...link, status: "failed", error: "Missing GitHub repo", updatedAt: nowISO() });
        continue;
      }
      try {
        const issue = await createGithubIssue({
          repo: task.githubRepo,
          title: task.title,
          body: taskMarkdown(task),
        });
        nextLinks.push({
          provider: "github",
          kind: "issue",
          id: issue.id,
          number: issue.number,
          url: issue.url,
          status: "synced",
          updatedAt: nowISO(),
        });
      } catch (err) {
        nextLinks.push({ ...link, status: "failed", error: err instanceof Error ? err.message : String(err), updatedAt: nowISO() });
      }
      continue;
    }

    if (link.provider === "notion" && link.kind === "task") {
      const databaseId = getWorkflowConfig().notion?.tasksDatabaseId;
      if (!databaseId) {
        nextLinks.push({ ...link, status: "failed", error: "Missing Notion tasks database ID", updatedAt: nowISO() });
        continue;
      }
      try {
        const page = await createNotionTask({
          databaseId,
          title: task.title,
          body: taskMarkdown(task),
        });
        nextLinks.push({
          provider: "notion",
          kind: "task",
          id: page.id,
          url: page.url,
          status: "synced",
          updatedAt: nowISO(),
        });
      } catch (err) {
        nextLinks.push({ ...link, status: "failed", error: err instanceof Error ? err.message : String(err), updatedAt: nowISO() });
      }
      continue;
    }

    nextLinks.push(link);
  }

  task = saveTask({ ...task, externalLinks: nextLinks });
  return task;
}

async function syncDecision(decisionId: string, dryRun: boolean): Promise<WorkflowDecision> {
  let decision = decisions()[decisionId];
  if (!decision) throw new Error(`Decision not found: ${decisionId}`);
  const nextLinks: WorkflowExternalLink[] = [];

  for (const link of decision.externalLinks) {
    if (link.status === "synced" || dryRun) {
      nextLinks.push(link);
      continue;
    }
    if (link.provider === "notion" && link.kind === "decision") {
      const databaseId = getWorkflowConfig().notion?.decisionsDatabaseId;
      if (!databaseId) {
        nextLinks.push({ ...link, status: "failed", error: "Missing Notion decisions database ID", updatedAt: nowISO() });
        continue;
      }
      try {
        const page = await createNotionTask({
          databaseId,
          title: `Decision: ${decision.projectName ?? "OpenVide"}`,
          body: decision.text,
        });
        nextLinks.push({ provider: "notion", kind: "decision", id: page.id, url: page.url, status: "synced", updatedAt: nowISO() });
      } catch (err) {
        nextLinks.push({ ...link, status: "failed", error: err instanceof Error ? err.message : String(err), updatedAt: nowISO() });
      }
      continue;
    }
    nextLinks.push(link);
  }

  decision = { ...decision, externalLinks: nextLinks, updatedAt: nowISO() };
  decisions()[decision.id] = decision;
  persist();
  return decision;
}

async function syncBriefing(briefingId: string, dryRun: boolean): Promise<WorkflowBriefing> {
  let briefing = briefings()[briefingId];
  if (!briefing) throw new Error(`Briefing not found: ${briefingId}`);
  const nextLinks: WorkflowExternalLink[] = [];

  for (const link of briefing.externalLinks) {
    if (link.status === "synced" || dryRun) {
      nextLinks.push(link);
      continue;
    }
    if (link.provider === "notion" && link.kind === "briefing") {
      const databaseId = getWorkflowConfig().notion?.briefingsDatabaseId;
      if (!databaseId) {
        nextLinks.push({ ...link, status: "failed", error: "Missing Notion briefings database ID", updatedAt: nowISO() });
        continue;
      }
      try {
        const page = await createNotionBriefing({
          databaseId,
          title: briefing.title,
          markdown: briefing.markdown,
        });
        nextLinks.push({ provider: "notion", kind: "briefing", id: page.id, url: page.url, status: "synced", updatedAt: nowISO() });
      } catch (err) {
        nextLinks.push({ ...link, status: "failed", error: err instanceof Error ? err.message : String(err), updatedAt: nowISO() });
      }
      continue;
    }
    nextLinks.push(link);
  }

  briefing = { ...briefing, externalLinks: nextLinks, updatedAt: nowISO() };
  briefings()[briefing.id] = briefing;
  persist();
  return briefing;
}

export async function syncWorkflow(dryRun: boolean): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (const task of Object.values(tasks())) {
    const pending = task.externalLinks.filter((link) => link.status === "pending" || link.status === "failed");
    if (!pending.length) continue;
    try {
      if (!dryRun) await syncTask(task.id, false);
      results.push({ target: `task:${task.id}`, ok: true, message: dryRun ? `${pending.length} pending link(s)` : "synced" });
    } catch (err) {
      results.push({ target: `task:${task.id}`, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const decision of Object.values(decisions())) {
    const pending = decision.externalLinks.filter((link) => link.status === "pending" || link.status === "failed");
    if (!pending.length) continue;
    try {
      if (!dryRun) await syncDecision(decision.id, false);
      results.push({ target: `decision:${decision.id}`, ok: true, message: dryRun ? `${pending.length} pending link(s)` : "synced" });
    } catch (err) {
      results.push({ target: `decision:${decision.id}`, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const briefing of Object.values(briefings())) {
    const pending = briefing.externalLinks.filter((link) => link.status === "pending" || link.status === "failed");
    if (!pending.length) continue;
    try {
      if (!dryRun) await syncBriefing(briefing.id, false);
      results.push({ target: `briefing:${briefing.id}`, ok: true, message: dryRun ? `${pending.length} pending link(s)` : "synced" });
    } catch (err) {
      results.push({ target: `briefing:${briefing.id}`, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!results.length) {
    results.push({ target: "workflow", ok: true, message: "Nothing to sync" });
  }
  return results;
}

export async function generateBriefing(): Promise<WorkflowBriefing> {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const lines: string[] = [
    `# OpenVide Briefing - ${date}`,
    "",
    "## Projects",
  ];

  for (const project of listProjects()) {
    const summary = await getGitSummary(project.path);
    lines.push(`- ${project.name} (${project.priority})${summary.branch ? ` - ${summary.branch}` : ""}${summary.dirty ? " - dirty" : ""}${project.github ? ` - ${project.github}` : ""}`);
  }

  const taskList = listWorkflowTasks();
  lines.push("", "## Active Tasks");
  const activeTasks = taskList.filter((task) => task.status !== "done");
  if (!activeTasks.length) lines.push("- None");
  for (const task of activeTasks) {
    lines.push(`- ${task.status}: ${task.title}${task.projectId ? ` (${task.projectId})` : ""}`);
  }

  lines.push("", "## Needs Review");
  const reviewTasks = taskList.filter((task) => task.status === "needs-review");
  if (!reviewTasks.length) lines.push("- None");
  for (const task of reviewTasks) lines.push(`- ${task.title}`);

  lines.push("", "## Blocked");
  const blockedTasks = taskList.filter((task) => task.status === "blocked");
  if (!blockedTasks.length) lines.push("- None");
  for (const task of blockedTasks) lines.push(`- ${task.title}${task.summary ? ` - ${task.summary}` : ""}`);

  lines.push("", "## GitHub");
  for (const project of listProjects().filter((item) => item.github)) {
    try {
      const [issues, prs] = await Promise.all([
        listGithubIssues(project.github!, 5),
        listGithubPullRequests(project.github!, 5),
      ]);
      lines.push(`### ${project.name}`);
      lines.push(`- Open issues: ${issues.length}`);
      for (const issue of issues.slice(0, 3)) lines.push(`  - #${issue.number} ${issue.title}`);
      lines.push(`- Open PRs: ${prs.length}`);
      for (const pr of prs.slice(0, 3)) lines.push(`  - #${pr.number} ${pr.title}`);
    } catch (err) {
      lines.push(`- ${project.name}: GitHub unavailable (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  lines.push("", "## Recent Decisions");
  const recentDecisions = Object.values(decisions()).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 5);
  if (!recentDecisions.length) lines.push("- None");
  for (const decision of recentDecisions) {
    lines.push(`- ${decision.projectName ?? "OpenVide"}: ${decision.text}`);
  }

  const markdown = lines.join("\n");
  const id = `brief_${date}`;
  const briefingDir = path.join(daemonDir(), "briefings");
  fs.mkdirSync(briefingDir, { recursive: true });
  const briefingPath = path.join(briefingDir, `${date}.md`);
  fs.writeFileSync(briefingPath, markdown + "\n");

  let briefing: WorkflowBriefing = {
    id,
    date,
    title: `OpenVide Briefing - ${date}`,
    markdown,
    path: briefingPath,
    externalLinks: briefings()[id]?.externalLinks ?? [],
    createdAt: briefings()[id]?.createdAt ?? nowISO(),
    updatedAt: nowISO(),
  };

  if (shouldSyncNotion() && getWorkflowConfig().notion?.briefingsDatabaseId && !findLink(briefing.externalLinks, "notion", "briefing")) {
    briefing.externalLinks = addOrReplaceLink(briefing.externalLinks, pendingLink("notion", "briefing"));
  }

  briefings()[id] = briefing;
  event("briefing.generated", "briefing", briefing.id, briefing.title);
  persist();
  briefing = await syncBriefing(id, false);
  return briefing;
}

export function listBriefings(): WorkflowBriefing[] {
  return Object.values(briefings()).sort((left, right) => right.date.localeCompare(left.date));
}

export async function addDecision(input: {
  project: string;
  text: string;
}): Promise<WorkflowDecision> {
  const project = findProject(input.project);
  let decision: WorkflowDecision = {
    id: newId("dec"),
    projectId: project?.id,
    projectName: project?.name ?? input.project,
    text: input.text.trim(),
    externalLinks: [],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  if (shouldSyncNotion() && getWorkflowConfig().notion?.decisionsDatabaseId) {
    decision.externalLinks = addOrReplaceLink(decision.externalLinks, pendingLink("notion", "decision"));
  }
  decisions()[decision.id] = decision;
  event("decision.created", "decision", decision.id, decision.text);
  persist();
  decision = await syncDecision(decision.id, false);
  return decision;
}

export function preparePullRequest(taskId: string, base = "main", draft = true): WorkflowPullRequestDraft {
  const task = requireTask(taskId);
  const issue = findLink(task.externalLinks, "github", "issue");
  const title = task.title;
  const body = [
    "## Summary",
    task.summary ?? task.goal,
    "",
    "## Linked Workflow",
    `OpenVide task: ${task.id}`,
    issue?.url ? `GitHub issue: ${issue.url}` : undefined,
    "",
    "## Verification",
    "- [ ] Checks run",
    "",
    "## Risks",
    "- Review required before merge",
  ].filter(Boolean).join("\n");

  return { title, body, base, draft };
}

export async function createPullRequest(taskId: string, base = "main", draft = true): Promise<WorkflowTask> {
  let task = requireTask(taskId);
  if (!task.repoPath) throw new Error(`Task ${task.id} does not have a repo path`);
  const pr = preparePullRequest(task.id, base, draft);
  const created = await createGithubPullRequest({
    cwd: task.repoPath,
    title: pr.title,
    body: pr.body,
    base: pr.base,
    draft: pr.draft,
  });
  task = saveTask({
    ...task,
    status: "needs-review",
    externalLinks: addOrReplaceLink(task.externalLinks, {
      provider: "github",
      kind: "pull-request",
      id: created.number ? String(created.number) : created.url,
      number: created.number,
      url: created.url,
      status: "synced",
      updatedAt: nowISO(),
    }),
  });
  event("task.pr.created", "task", task.id, created.url ?? "Pull request created");
  return task;
}

export function toTaskResponse(task: WorkflowTask): IpcResponse {
  return { ok: true, workflowTask: task };
}

export function logWorkflowSummary(): void {
  const state = workflowState();
  log(`Workflow initialized projects=${Object.keys(state.workflowProjects!).length} tasks=${Object.keys(state.workflowTasks!).length}`);
}
