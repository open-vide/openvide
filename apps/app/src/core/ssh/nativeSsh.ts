import SSHClient, { PtyType } from "@dylankenneally/react-native-ssh-sftp";
import { newId } from "../id";
import type { SshCredentials, TargetProfile } from "../types";

export interface SshRunResult {
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
}

export interface SshRunHandle {
  requestId: string;
  wait: Promise<SshRunResult>;
  cancel: () => Promise<void>;
  sendInput: (input: string) => Promise<void>;
}

export interface RunCommandOptions {
  mode?: "interactive" | "scripted";
}

type AnySshClient = {
  on: (eventName: string, handler: (value: string) => void) => void;
  off?: (eventName: string, handler: (...args: unknown[]) => void) => void;
  startShell: (ptyType: PtyType) => Promise<string>;
  writeToShell: (command: string) => Promise<string>;
  closeShell: () => void;
  disconnect: () => void;
};

interface SessionCommandContext {
  requestId: string;
  mode: "interactive" | "scripted";
  markerRegex: RegExp;
  marker: string;
  stdout: string;
  stderr: string;
  markerSearchBuffer: string;
  handlers: {
    onStdout: (chunk: string) => void;
    onStderr: (chunk: string) => void;
  };
  resolve: (result: SshRunResult) => void;
  reject: (error: Error) => void;
  finished: boolean;
}

interface SessionState {
  targetId: string;
  signature: string;
  client: AnySshClient;
  cursor: number;
  bufferCursor: number;
  buffer: string;
  lastDeliveredCursor: number;
  shellReady: boolean;
  shellReadyPromise: Promise<void>;
  resolveShellReady: () => void;
  active?: SessionCommandContext;
  shellHandler?: (value: string) => void;
  errorHandler?: (value: unknown) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripForMarkerSearch(value: string): string {
  return value
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, "")
    .replace(/\[(?:\d{1,4}(?:;\d{1,4})*|\?\d{1,4})[A-Za-z]/g, "")
    .replace(/\[(?:\?[\d;]*)?[\d;]*[ABCDHIJKfhlmnsu]/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

export class NativeSshClient {
  readonly available = true;
  private readonly sessions = new Map<string, SessionState>();
  private readonly connecting = new Map<string, Promise<SessionState>>();
  private static readonly BUFFER_LIMIT = 1024 * 1024 * 2;

  private async writeToShellWithRetry(client: AnySshClient, command: string): Promise<void> {
    const maxAttempts = 8;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await client.writeToShell(command);
        return;
      } catch (error) {
        const message = errorMessage(error);
        const isTransientShellError =
          /shell required/i.test(message) ||
          /code\s*=\s*-?37/i.test(message) ||
          /eagain/i.test(message) ||
          /resource temporarily unavailable/i.test(message);
        if (!isTransientShellError || attempt >= maxAttempts) {
          throw (error instanceof Error ? error : new Error(message));
        }
        await sleep(150 * attempt);
      }
    }
  }

  private sessionSignature(target: TargetProfile): string {
    return `${target.host}:${target.port}:${target.username}:${target.authMethod}`;
  }

  private async connect(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<AnySshClient> {
    console.log("[OV:ssh] connect() called:", target.username + "@" + target.host + ":" + target.port, "auth=" + target.authMethod);
    if (target.authMethod === "password") {
      if (!credentials.password) {
        console.error("[OV:ssh] connect FAILED: missing password");
        throw new Error("Missing password for password-auth target.");
      }

      console.log("[OV:ssh] attempting SSHClient.connectWithPassword...");
      try {
        const client = (await SSHClient.connectWithPassword(
          target.host,
          target.port,
          target.username,
          credentials.password,
        )) as unknown as AnySshClient;
        console.log("[OV:ssh] connectWithPassword SUCCESS");
        return client;
      } catch (error) {
        console.error("[OV:ssh] connectWithPassword FAILED:", errorMessage(error));
        throw error;
      }
    }

    if (!credentials.privateKey) {
      console.error("[OV:ssh] connect FAILED: missing private key");
      throw new Error("Missing private key for key-auth target.");
    }

    console.log("[OV:ssh] attempting SSHClient.connectWithKey...");
    try {
      const client = (await SSHClient.connectWithKey(
        target.host,
        target.port,
        target.username,
        credentials.privateKey,
        credentials.privateKeyPassphrase,
      )) as unknown as AnySshClient;
      console.log("[OV:ssh] connectWithKey SUCCESS");
      return client;
    } catch (error) {
      console.error("[OV:ssh] connectWithKey FAILED:", errorMessage(error));
      throw error;
    }
  }

  private finishCommand(
    session: SessionState,
    command: SessionCommandContext,
    result: SshRunResult,
  ): void {
    if (command.finished) {
      return;
    }
    command.finished = true;
    if (session.active === command) {
      session.active = undefined;
    }
    command.resolve(result);
  }

  private failCommand(
    session: SessionState,
    command: SessionCommandContext,
    error: Error,
  ): void {
    if (command.finished) {
      return;
    }
    command.finished = true;
    if (session.active === command) {
      session.active = undefined;
    }
    command.reject(error);
  }

  private onShellData(session: SessionState, chunk: string): void {
    const normalized = chunk.replace(/\r\n/g, "\n");
    session.cursor += normalized.length;
    session.buffer += normalized;
    if (session.buffer.length > NativeSshClient.BUFFER_LIMIT) {
      const excess = session.buffer.length - NativeSshClient.BUFFER_LIMIT;
      session.buffer = session.buffer.slice(excess);
      session.bufferCursor += excess;
    }
    if (!session.shellReady && normalized.trim().length > 0) {
      session.shellReady = true;
      session.resolveShellReady();
    }

    const active = session.active;
    if (!active || active.finished) {
      return;
    }

    active.stdout += normalized;
    active.handlers.onStdout(normalized);
    session.lastDeliveredCursor = session.cursor;

    if (active.mode !== "scripted") {
      return;
    }

    active.markerSearchBuffer += stripForMarkerSearch(normalized);
    const exitMatch = active.markerRegex.exec(active.markerSearchBuffer);
    if (!exitMatch) {
      return;
    }

    const exitCode = Number.parseInt(exitMatch[1] ?? "1", 10);
    this.finishCommand(session, active, {
      exitCode: Number.isFinite(exitCode) ? exitCode : 1,
      stdout: active.stdout,
      stderr: active.stderr,
    });
  }

  private onShellError(session: SessionState, event: unknown): void {
    const message = event?.toString?.() ?? "SSH shell error";
    const active = session.active;
    if (active && !active.finished) {
      active.stderr += `${message}\n`;
      active.handlers.onStderr(message);
      this.failCommand(session, active, new Error(message));
    }
    void this.resetTargetSession(session.targetId);
  }

  private async createSession(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<SessionState> {
    console.log("[OV:ssh] createSession() for", target.label, "(" + target.id + ")");
    const client = await this.connect(target, credentials);
    console.log("[OV:ssh] createSession: connect returned, setting up shell...");

    let resolveShellReady: (() => void) | undefined;
    const shellReadyPromise = new Promise<void>((resolve) => {
      resolveShellReady = resolve;
    });

    const session: SessionState = {
      targetId: target.id,
      signature: this.sessionSignature(target),
      client,
      cursor: 0,
      bufferCursor: 0,
      buffer: "",
      lastDeliveredCursor: 0,
      shellReady: false,
      shellReadyPromise,
      resolveShellReady: () => resolveShellReady?.(),
    };

    const shellHandler = (chunk: string): void => {
      console.log("[OV:ssh] Shell data received:", chunk.length, "chars, first50:", JSON.stringify(chunk.slice(0, 50)));
      this.onShellData(session, chunk);
    };
    const errorHandler = (event: unknown): void => {
      console.error("[OV:ssh] Shell Error event:", event);
      this.onShellError(session, event);
    };
    session.shellHandler = shellHandler;
    session.errorHandler = errorHandler as (value: unknown) => void;
    client.on("Shell", shellHandler);
    client.on("Error", errorHandler as (value: string) => void);

    try {
      console.log("[OV:ssh] calling startShell(XTERM)...");
      await client.startShell(PtyType.XTERM);
      console.log("[OV:ssh] startShell returned, waiting for shell ready (max 1s)...");
      await Promise.race([session.shellReadyPromise, sleep(1000)]);
      console.log("[OV:ssh] createSession DONE: shellReady=" + session.shellReady);
      return session;
    } catch (error) {
      console.error("[OV:ssh] createSession shell setup FAILED:", errorMessage(error));
      this.disconnectSession(session);
      throw (error instanceof Error ? error : new Error(String(error)));
    }
  }

  private disconnectSession(session: SessionState, reason?: string): void {
    const current = this.sessions.get(session.targetId);
    if (current === session) {
      this.sessions.delete(session.targetId);
    }

    if (session.active && !session.active.finished) {
      this.failCommand(
        session,
        session.active,
        new Error(reason ?? "SSH session closed."),
      );
    }

    // Remove event listeners to prevent memory leaks on reconnect
    if (session.shellHandler) {
      session.client.off?.("Shell", session.shellHandler as (...args: unknown[]) => void);
    }
    if (session.errorHandler) {
      session.client.off?.("Error", session.errorHandler as (...args: unknown[]) => void);
    }

    try {
      session.client.closeShell();
    } catch {
      // no-op
    }
    try {
      session.client.disconnect();
    } catch {
      // no-op
    }
  }

  private async getOrCreateSession(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<SessionState> {
    const signature = this.sessionSignature(target);
    const existing = this.sessions.get(target.id);
    console.log("[OV:ssh] getOrCreateSession:", target.id, "existing=" + !!existing, "signatureMatch=" + (existing?.signature === signature));
    if (existing && existing.signature === signature) {
      console.log("[OV:ssh] reusing existing session");
      return existing;
    }
    if (existing) {
      console.log("[OV:ssh] signature mismatch, reconnecting");
      this.disconnectSession(existing, "Target connection profile changed. Reconnecting.");
    }

    const inFlight = this.connecting.get(target.id);
    if (inFlight) {
      console.log("[OV:ssh] waiting for in-flight connection...");
      return await inFlight;
    }

    console.log("[OV:ssh] creating NEW session for", target.label);
    const sessionPromise = this.createSession(target, credentials)
      .then((session) => {
        this.sessions.set(target.id, session);
        this.connecting.delete(target.id);
        console.log("[OV:ssh] session stored for", target.id);
        return session;
      })
      .catch((error) => {
        this.connecting.delete(target.id);
        console.error("[OV:ssh] session creation FAILED for", target.id, ":", errorMessage(error));
        throw error;
      });

    this.connecting.set(target.id, sessionPromise);
    return await sessionPromise;
  }

  async testConnection(
    target: TargetProfile,
    credentials: SshCredentials,
  ): Promise<{ success: boolean; error?: string }> {
    console.log("[OV:ssh] testConnection:", target.username + "@" + target.host + ":" + target.port);
    try {
      const client = await this.connect(target, credentials);
      try {
        client.disconnect();
      } catch {
        // no-op
      }
      console.log("[OV:ssh] testConnection: SUCCESS");
      return { success: true };
    } catch (error) {
      const message = errorMessage(error);
      console.log("[OV:ssh] testConnection: FAILED:", message);
      return { success: false, error: message };
    }
  }

  async resetTargetSession(targetId: string): Promise<void> {
    const existing = this.sessions.get(targetId);
    if (existing) {
      this.disconnectSession(existing, "Session reset requested.");
    }
    const inFlight = this.connecting.get(targetId);
    if (inFlight) {
      try {
        const session = await inFlight;
        this.disconnectSession(session, "Session reset requested.");
      } catch {
        // no-op
      }
    }
  }

  async dispose(): Promise<void> {
    const targetIds = new Set<string>([
      ...this.sessions.keys(),
      ...this.connecting.keys(),
    ]);
    for (const targetId of targetIds) {
      await this.resetTargetSession(targetId);
    }
    this.sessions.clear();
    this.connecting.clear();
  }

  private async dispatchCommand(
    session: SessionState,
    commandContext: SessionCommandContext,
    command: string,
  ): Promise<void> {
    const normalized = command.replace(/\r\n/g, "\n");
    if (commandContext.mode === "interactive") {
      const payload =
        normalized.trim().length > 0
          ? normalized.endsWith("\n")
            ? normalized
            : `${normalized}\n`
          : "\n";
      await this.writeToShellWithRetry(session.client, payload);
      return;
    }

    const shellCommand = normalized.trim().length > 0 ? normalized : ":";
    const script = `${shellCommand}\nOV_EXIT_CODE=$?\nprintf "\\n${commandContext.marker}%s\\n" "$OV_EXIT_CODE"\n`;
    await this.writeToShellWithRetry(session.client, script);
  }

  async runCommand(
    target: TargetProfile,
    credentials: SshCredentials,
    command: string,
    handlers: {
      onStdout: (chunk: string) => void;
      onStderr: (chunk: string) => void;
    },
    options?: RunCommandOptions,
  ): Promise<SshRunHandle> {
    const mode = options?.mode ?? "scripted";
    const requestId = newId("exec");
    console.log("[OV:ssh] runCommand:", requestId, "mode=" + mode, "target=" + target.label, "cmd=" + command.slice(0, 100));
    const marker = `__OV_EXIT_${requestId}__`;
    const markerRegex = new RegExp(`${escapeRegExp(marker)}\\s*(\\d+)`);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const session = await this.getOrCreateSession(target, credentials);
      if (session.active && !session.active.finished) {
        console.warn("[OV:ssh] cancelling previous active command to run new one:", session.active.requestId);
        this.finishCommand(session, session.active, {
          exitCode: 130,
          signal: "SIGINT",
          stdout: session.active.stdout,
          stderr: session.active.stderr,
        });
        // Send Ctrl+C to stop the previous command in the shell
        try {
          await this.writeToShellWithRetry(session.client, "\u0003\n");
          await sleep(100);
        } catch { /* no-op */ }
      }

      let resolveWait: ((result: SshRunResult) => void) | undefined;
      let rejectWait: ((error: Error) => void) | undefined;
      const wait = new Promise<SshRunResult>((resolve, reject) => {
        resolveWait = resolve;
        rejectWait = reject;
      });

      const commandContext: SessionCommandContext = {
        requestId,
        mode,
        markerRegex,
        marker,
        stdout: "",
        stderr: "",
        markerSearchBuffer: "",
        handlers,
        resolve: (result) => resolveWait?.(result),
        reject: (error) => rejectWait?.(error),
        finished: false,
      };
      session.active = commandContext;
      if (session.cursor > session.lastDeliveredCursor && session.buffer.length > 0) {
        const from = Math.max(0, session.lastDeliveredCursor);
        const end = session.cursor;
        if (from < end) {
          const offset = Math.max(0, from - session.bufferCursor);
          if (offset < session.buffer.length) {
            const replay = session.buffer.slice(offset);
            if (replay.length > 0) {
              commandContext.stdout += replay;
              handlers.onStdout(replay);
            }
          }
        }
        session.lastDeliveredCursor = session.cursor;
      }

      try {
        await this.dispatchCommand(session, commandContext, command);
      } catch (error) {
        if (session.active === commandContext) {
          session.active = undefined;
        }
        commandContext.finished = true;
        const dispatchError = error instanceof Error ? error : new Error(String(error));
        if (attempt < 2) {
          await this.resetTargetSession(target.id);
          continue;
        }
        throw dispatchError;
      }

      return {
        requestId,
        wait,
        cancel: async () => {
          if (commandContext.finished) {
            return;
          }

          if (session.active === commandContext) {
            session.active = undefined;
          }

          try {
            await this.writeToShellWithRetry(session.client, "\u0003");
            // Restore echo in case the cancelled command disabled it (e.g. CLI detection)
            await this.writeToShellWithRetry(session.client, "\nstty echo 2>/dev/null\n");
            if (mode === "scripted") {
              await this.writeToShellWithRetry(session.client, `\nprintf "\\n${marker}130\\n"\n`);
            }
          } catch {
            // no-op
          }

          this.finishCommand(session, commandContext, {
            exitCode: 130,
            signal: "SIGINT",
            stdout: commandContext.stdout,
            stderr: commandContext.stderr,
          });
        },
        sendInput: async (input: string) => {
          if (commandContext.finished || session.active !== commandContext) {
            throw new Error("Command is no longer running.");
          }
          await this.writeToShellWithRetry(session.client, input);
        },
      };
    }

    throw new Error("Failed to start SSH command.");
  }
}
