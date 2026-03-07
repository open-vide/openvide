import type { SshCredentials, TargetProfile } from "../types";
import { getHomeDirectory, listDirectory, searchFiles, createFile, createDirectory, type RemoteFileEntry } from "./fileOps";
import type { NativeSshClient } from "./nativeSsh";

export class RequestSupersededError extends Error {
  constructor() {
    super("Request superseded by a newer file browser command.");
    this.name = "RequestSupersededError";
  }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError" || /cancelled/i.test(error.message);
  }
  return false;
}

interface RemoteFsBrowserControllerInput {
  ssh: NativeSshClient;
  target: TargetProfile;
  loadCredentials: () => Promise<SshCredentials | null | undefined>;
  directoriesOnly?: boolean;
}

export class RemoteFsBrowserController {
  private readonly ssh: NativeSshClient;
  private readonly target: TargetProfile;
  private readonly loadCredentialsFn: () => Promise<SshCredentials | null | undefined>;
  private readonly directoriesOnly: boolean;
  private disposed = false;
  private activeAbort?: AbortController;
  private queue: Promise<void> = Promise.resolve();
  private latestRequestId = 0;
  private credentialsPromise?: Promise<SshCredentials>;
  private readonly cacheTtlMs = 10_000;
  private readonly pathCache = new Map<string, { entries: RemoteFileEntry[]; at: number }>();

  constructor(input: RemoteFsBrowserControllerInput) {
    this.ssh = input.ssh;
    this.target = input.target;
    this.loadCredentialsFn = input.loadCredentials;
    this.directoriesOnly = input.directoriesOnly ?? false;
  }

  private async getCredentials(): Promise<SshCredentials> {
    if (!this.credentialsPromise) {
      this.credentialsPromise = (async () => {
        const creds = await this.loadCredentialsFn();
        if (!creds) {
          throw new Error("No credentials found");
        }
        return creds;
      })();
    }
    try {
      return await this.credentialsPromise;
    } catch (error) {
      this.credentialsPromise = undefined;
      throw error;
    }
  }

  private async runLatest<T>(runner: (signal: AbortSignal, creds: SshCredentials) => Promise<T>): Promise<T> {
    const requestId = ++this.latestRequestId;
    this.activeAbort?.abort();

    const task = this.queue.then(async () => {
      if (this.disposed || requestId !== this.latestRequestId) {
        throw new RequestSupersededError();
      }

      const abortController = new AbortController();
      this.activeAbort = abortController;

      try {
        const creds = await this.getCredentials();
        if (this.disposed || requestId !== this.latestRequestId || abortController.signal.aborted) {
          throw new RequestSupersededError();
        }

        const result = await runner(abortController.signal, creds);
        if (this.disposed || requestId !== this.latestRequestId || abortController.signal.aborted) {
          throw new RequestSupersededError();
        }
        return result;
      } catch (error) {
        if (
          this.disposed ||
          requestId !== this.latestRequestId ||
          abortController.signal.aborted ||
          isAbortError(error)
        ) {
          throw new RequestSupersededError();
        }
        throw error;
      } finally {
        if (this.activeAbort === abortController) {
          this.activeAbort = undefined;
        }
      }
    });

    this.queue = task.then(
      () => undefined,
      () => undefined,
    );

    return await task;
  }

  async resolveStartPath(initialPath?: string): Promise<string> {
    if (initialPath && initialPath.trim().length > 0) {
      return initialPath;
    }

    return await this.runLatest(async (signal, creds) =>
      await getHomeDirectory(this.ssh, this.target, creds, { signal }));
  }

  async list(path: string): Promise<RemoteFileEntry[]> {
    const cached = this.pathCache.get(path);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) {
      return cached.entries;
    }

    return await this.runLatest(async (signal, creds) => {
      const entries = await listDirectory(this.ssh, this.target, creds, path, { signal });
      const value = this.directoriesOnly ? entries.filter((entry) => entry.isDirectory) : entries;
      this.pathCache.set(path, { entries: value, at: Date.now() });
      return value;
    });
  }

  async search(basePath: string, query: string): Promise<RemoteFileEntry[]> {
    return await this.runLatest(async (signal, creds) => {
      return await searchFiles(this.ssh, this.target, creds, basePath, query, { signal });
    });
  }

  async createFile(dirPath: string, name: string): Promise<void> {
    const fullPath = (dirPath.endsWith("/") ? dirPath : dirPath + "/") + name;
    await this.runLatest(async (signal, creds) => {
      await createFile(this.ssh, this.target, creds, fullPath, { signal });
    });
    this.pathCache.delete(dirPath);
  }

  async createDirectory(dirPath: string, name: string): Promise<void> {
    const fullPath = (dirPath.endsWith("/") ? dirPath : dirPath + "/") + name;
    await this.runLatest(async (signal, creds) => {
      await createDirectory(this.ssh, this.target, creds, fullPath, { signal });
    });
    this.pathCache.delete(dirPath);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.activeAbort?.abort();
    this.activeAbort = undefined;
    this.pathCache.clear();
    await this.queue;
  }
}
