import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GithubIssueRef {
  number?: number;
  url?: string;
  id?: string;
}

export interface GithubListItem {
  number: number;
  title: string;
  url: string;
  updatedAt?: string;
  state?: string;
}

export function parseGithubRemote(remote: string): string | undefined {
  const trimmed = remote.trim();
  const sshMatch = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(trimmed);
  if (sshMatch) return sshMatch[1];

  const httpsMatch = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(trimmed);
  if (httpsMatch) return httpsMatch[1];

  return undefined;
}

export async function detectGithubRepo(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "remote", "get-url", "origin"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return parseGithubRemote(stdout);
  } catch {
    return undefined;
  }
}

export async function getGitSummary(cwd: string): Promise<{
  branch?: string;
  dirty: boolean;
  lastCommit?: string;
}> {
  const summary: { branch?: string; dirty: boolean; lastCommit?: string } = { dirty: false };

  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "branch", "--show-current"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    summary.branch = stdout.trim() || undefined;
  } catch {
    // ignore
  }

  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "status", "--short"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    summary.dirty = stdout.trim().length > 0;
  } catch {
    // ignore
  }

  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "log", "-1", "--pretty=%h %s"], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    summary.lastCommit = stdout.trim() || undefined;
  } catch {
    // ignore
  }

  return summary;
}

export async function createGithubIssue(input: {
  repo: string;
  title: string;
  body: string;
}): Promise<GithubIssueRef> {
  const { stdout } = await execFileAsync(
    "gh",
    ["issue", "create", "--repo", input.repo, "--title", input.title, "--body", input.body],
    {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 4,
    },
  );
  const url = stdout.trim().split(/\s+/).find((part) => part.startsWith("https://github.com/"));
  const number = url ? Number(url.split("/").pop()) : undefined;
  return {
    id: number ? String(number) : url,
    number: Number.isFinite(number) ? number : undefined,
    url,
  };
}

export async function commentOnGithubIssue(input: {
  issueUrlOrNumber: string;
  repo?: string;
  body: string;
}): Promise<void> {
  const args = ["issue", "comment", input.issueUrlOrNumber, "--body", input.body];
  if (input.repo) args.push("--repo", input.repo);
  await execFileAsync("gh", args, {
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 4,
  });
}

export async function closeGithubIssue(input: {
  issueUrlOrNumber: string;
  repo?: string;
  comment?: string;
}): Promise<void> {
  const args = ["issue", "close", input.issueUrlOrNumber];
  if (input.repo) args.push("--repo", input.repo);
  if (input.comment) args.push("--comment", input.comment);
  await execFileAsync("gh", args, {
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 4,
  });
}

export async function listGithubIssues(repo: string, limit = 10): Promise<GithubListItem[]> {
  const { stdout } = await execFileAsync(
    "gh",
    ["issue", "list", "--repo", repo, "--state", "open", "--limit", String(limit), "--json", "number,title,url,updatedAt,state"],
    {
      timeout: 20000,
      maxBuffer: 1024 * 1024 * 4,
    },
  );
  return JSON.parse(stdout || "[]") as GithubListItem[];
}

export async function listGithubPullRequests(repo: string, limit = 10): Promise<GithubListItem[]> {
  const { stdout } = await execFileAsync(
    "gh",
    ["pr", "list", "--repo", repo, "--state", "open", "--limit", String(limit), "--json", "number,title,url,updatedAt,state"],
    {
      timeout: 20000,
      maxBuffer: 1024 * 1024 * 4,
    },
  );
  return JSON.parse(stdout || "[]") as GithubListItem[];
}

export async function createGithubPullRequest(input: {
  cwd: string;
  title: string;
  body: string;
  base: string;
  draft: boolean;
}): Promise<{ url?: string; number?: number }> {
  const args = ["pr", "create", "--title", input.title, "--body", input.body, "--base", input.base];
  if (input.draft) args.push("--draft");
  const { stdout } = await execFileAsync("gh", args, {
    cwd: input.cwd,
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 4,
  });
  const url = stdout.trim().split(/\s+/).find((part) => part.startsWith("https://github.com/"));
  const number = url ? Number(url.split("/").pop()) : undefined;
  return {
    url,
    number: Number.isFinite(number) ? number : undefined,
  };
}
