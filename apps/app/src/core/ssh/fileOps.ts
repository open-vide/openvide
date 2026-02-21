import type { NativeSshClient } from "./nativeSsh";
import type { SshCredentials, TargetProfile } from "../types";

export interface RemoteFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  permissions: string;
}

interface CommandOptions {
  timeoutMs: number;
  timeoutMessage: string;
  signal?: AbortSignal;
  busyRetryCount?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(text: string): string {
  return text
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, "")
    .replace(/\[(?:\d{1,4}(?:;\d{1,4})*|\?\d{1,4})[A-Za-z]/g, "")
    .replace(/\[(?:\?[\d;]*)?[\d;]*[ABCDHIJKfhlmnsu]/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

function isBusyCommandError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /another command is already running/i.test(message);
}

function createAbortError(): Error {
  const error = new Error("Operation cancelled");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError" || /cancelled/i.test(error.message);
  }
  return false;
}

function parseLsLine(line: string, basePath: string): RemoteFileEntry | null {
  // Handles both GNU ls --time-style=long-iso (8+ columns) and BSD ls (9+ columns)
  // GNU:  drwxr-xr-x 2 user group 4096 2025-01-15 10:30 dirname
  // BSD:  drwxr-xr-x  2 user  group  4096 Jan 15 10:30 dirname
  const trimmed = stripAnsi(line).trim();
  if (trimmed.length === 0 || trimmed.startsWith("total ")) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 8) return null;

  const permissions = parts[0] ?? "";
  const sizeStr = parts[4] ?? "0";
  const isDirectory = permissions.startsWith("d");
  const size = parseInt(sizeStr, 10) || 0;
  const normalizedBase = basePath.endsWith("/") ? basePath : basePath + "/";

  // GNU long-iso: date is YYYY-MM-DD at index 5, time at index 6, name from index 7
  // BSD default:  month at index 5, day at index 6, time/year at index 7, name from index 8
  const isIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(parts[5] ?? "");

  let modified: string;
  let name: string;
  if (isIsoDate) {
    modified = `${parts[5]} ${parts[6] ?? ""}`;
    name = parts.slice(7).join(" ");
  } else {
    modified = `${parts[5]} ${parts[6]} ${parts[7] ?? ""}`;
    name = parts.slice(8).join(" ");
  }

  if (!name || name === "." || name === "..") return null;

  return {
    name,
    path: normalizedBase + name,
    isDirectory,
    size,
    modified,
    permissions,
  };
}

async function runScriptedCommand(
  ssh: NativeSshClient,
  target: TargetProfile,
  creds: SshCredentials,
  command: string,
  options: CommandOptions,
): Promise<string> {
  const retries = options.busyRetryCount ?? 1;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    try {
      const handle = await ssh.runCommand(
        target,
        creds,
        command,
        {
          onStdout: () => {},
          onStderr: () => {},
        },
        { mode: "scripted" },
      );

      const onAbort = (): void => {
        void handle.cancel();
      };
      options.signal?.addEventListener("abort", onAbort);

      try {
        const result = await Promise.race([
          handle.wait,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), options.timeoutMs)),
        ]);

        if (!result) {
          await handle.cancel();
          if (options.signal?.aborted) {
            throw createAbortError();
          }
          throw new Error(options.timeoutMessage);
        }

        if (options.signal?.aborted) {
          await handle.cancel();
          throw createAbortError();
        }

        return result.stdout;
      } finally {
        options.signal?.removeEventListener("abort", onAbort);
      }
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) {
        throw createAbortError();
      }

      if (attempt < retries && isBusyCommandError(error)) {
        await sleep(120 * (attempt + 1));
        continue;
      }

      throw error;
    }
  }

  throw new Error("Command failed");
}

export async function getHomeDirectory(
  ssh: NativeSshClient,
  target: TargetProfile,
  creds: SshCredentials,
  options?: { signal?: AbortSignal },
): Promise<string> {
  const output = await runScriptedCommand(
    ssh,
    target,
    creds,
    "eval echo ~",
    {
      timeoutMs: 5000,
      timeoutMessage: "Resolving home directory timed out",
      signal: options?.signal,
    },
  );

  const homePath = output.trim().split("\n").pop()?.trim();
  return homePath && homePath.startsWith("/") ? homePath : "/";
}

export async function listDirectory(
  ssh: NativeSshClient,
  target: TargetProfile,
  creds: SshCredentials,
  path: string,
  options?: { signal?: AbortSignal },
): Promise<RemoteFileEntry[]> {
  const safePath = path.replace(/'/g, "'\\''");
  // GNU ls supports --time-style; BSD ls (macOS) does not — fall back to plain ls -la
  // Use `command ls` to bypass shell aliases/functions (e.g. alias ls='ls -G' with color escapes).
  const command = `command ls -la --time-style=long-iso '${safePath}' 2>/dev/null || command ls -la '${safePath}'`;

  const output = await runScriptedCommand(
    ssh,
    target,
    creds,
    command,
    {
      timeoutMs: 10000,
      timeoutMessage: "Listing directory timed out",
      signal: options?.signal,
      busyRetryCount: 1,
    },
  );

  const lines = output.split("\n");
  const entries: RemoteFileEntry[] = [];

  for (const line of lines) {
    const entry = parseLsLine(line, path);
    if (entry) entries.push(entry);
  }

  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readFile(
  ssh: NativeSshClient,
  target: TargetProfile,
  creds: SshCredentials,
  path: string,
  maxBytes: number = 102400,
  options?: { signal?: AbortSignal },
): Promise<{ content: string; truncated: boolean }> {
  const safePath = path.replace(/'/g, "'\\''");
  const command = `head -c ${maxBytes} '${safePath}'`;

  const content = await runScriptedCommand(
    ssh,
    target,
    creds,
    command,
    {
      timeoutMs: 10000,
      timeoutMessage: "Reading file timed out",
      signal: options?.signal,
      busyRetryCount: 1,
    },
  );

  // Check if file is larger than maxBytes
  const truncated = content.length >= maxBytes;

  return { content, truncated };
}

export async function writeFile(
  ssh: NativeSshClient,
  target: TargetProfile,
  creds: SshCredentials,
  path: string,
  content: string,
  options?: { signal?: AbortSignal; backup?: boolean },
): Promise<void> {
  const safePath = path.replace(/'/g, "'\\''");

  // Create .bak backup if requested
  if (options?.backup) {
    const backupCmd = `cp '${safePath}' '${safePath}.bak' 2>/dev/null || true`;
    await runScriptedCommand(ssh, target, creds, backupCmd, {
      timeoutMs: 5000,
      timeoutMessage: "Creating backup timed out",
      signal: options?.signal,
    });
  }

  // Use heredoc to write file content safely
  // The delimiter is chosen to be unlikely in file content
  const delimiter = "OPENVIDE_WRITE_EOF_" + Date.now();
  const command = `cat > '${safePath}' << '${delimiter}'\n${content}\n${delimiter}`;

  await runScriptedCommand(ssh, target, creds, command, {
    timeoutMs: 15000,
    timeoutMessage: "Writing file timed out",
    signal: options?.signal,
    busyRetryCount: 1,
  });
}

export async function searchFiles(
  ssh: NativeSshClient,
  target: TargetProfile,
  creds: SshCredentials,
  basePath: string,
  query: string,
  options?: { signal?: AbortSignal },
): Promise<RemoteFileEntry[]> {
  const safePath = basePath.replace(/'/g, "'\\''");
  const safeQuery = query.replace(/'/g, "'\\''");
  // Use printf to output type indicator (d for directory, f for file) followed by path
  // Fall back to plain find output on systems without -printf (e.g. BSD/macOS)
  const command = `find '${safePath}' -maxdepth 3 -iname '*${safeQuery}*' -not -path '*/\\.git/*' -printf '%y %p\\n' 2>/dev/null | head -50 || find '${safePath}' -maxdepth 3 -iname '*${safeQuery}*' -not -path '*/\\.git/*' 2>/dev/null | head -50`;

  const output = await runScriptedCommand(ssh, target, creds, command, {
    timeoutMs: 15000,
    timeoutMessage: "File search timed out",
    signal: options?.signal,
    busyRetryCount: 1,
  });

  const entries: RemoteFileEntry[] = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // Try to parse "type path" format from -printf
    let isDirectory = false;
    let filePath = line;
    if (/^[dflbcps] /.test(line)) {
      isDirectory = line[0] === "d";
      filePath = line.slice(2);
    }
    const name = filePath.split("/").pop() ?? filePath;
    if (!name) continue;
    entries.push({ name, path: filePath, isDirectory, size: 0, modified: "", permissions: "" });
  }
  return entries;
}
