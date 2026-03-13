import { newId } from "../id";
import { parseLogLine, resolveStatus, summarizeRun } from "../parser";
import { Redactor } from "../redaction";
import { NativeSshClient } from "../ssh/nativeSsh";
import type {
  ParsedEvent,
  RawLogLine,
  RunPhase,
  RunRecord,
  RunType,
  SshCredentials,
  TargetProfile,
  ToolAction,
  ToolName,
} from "../types";

interface ActiveRun {
  run: RunRecord;
  fallbackPhase: RunPhase;
  redactor: Redactor;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  cancelRequested: boolean;
  timedOut: boolean;
  cancel: () => Promise<void>;
  sendInput: (input: string) => Promise<void>;
  stdoutRemainder: string;
  stderrRemainder: string;
  lastStdoutRawId?: number;
  lastStdoutRawTimestamp?: string;
  lastStderrRawId?: number;
  lastStderrRawTimestamp?: string;
}

type RunListener = (run: RunRecord) => void;

function cloneRun(run: RunRecord): RunRecord {
  return JSON.parse(JSON.stringify(run)) as RunRecord;
}

export class RunEngine {
  private readonly ssh: NativeSshClient;
  private readonly active = new Map<string, ActiveRun>();
  private readonly listeners = new Map<string, Set<RunListener>>();
  private readonly persist: (run: RunRecord) => Promise<void>;

  constructor(
    ssh: NativeSshClient,
    persist: (run: RunRecord) => Promise<void>,
  ) {
    this.ssh = ssh;
    this.persist = persist;
  }

  subscribe(runId: string, listener: RunListener): () => void {
    const set = this.listeners.get(runId) ?? new Set<RunListener>();
    set.add(listener);
    this.listeners.set(runId, set);

    return () => {
      const current = this.listeners.get(runId);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  async resetTargetSession(targetId: string): Promise<void> {
    await this.ssh.resetTargetSession(targetId);
  }

  private notify(run: RunRecord): void {
    const listeners = this.listeners.get(run.id);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(cloneRun(run));
    }
  }

  private appendLine(
    active: ActiveRun,
    stream: RawLogLine["stream"],
    line: string,
  ): ParsedEvent {
    const raw = this.appendRawLog(active, stream, line);
    return this.appendParsedLine(active, stream, raw.text, raw.id, raw.timestamp);
  }

  private appendRawLog(
    active: ActiveRun,
    stream: RawLogLine["stream"],
    text: string,
  ): RawLogLine {
    const redacted = active.redactor.redact(text);
    const raw: RawLogLine = {
      id: active.run.rawLogs.length + 1,
      seq: active.run.rawLogs.length + 1,
      timestamp: new Date().toISOString(),
      stream,
      text: redacted,
    };
    active.run.rawLogs.push(raw);
    return raw;
  }

  private appendParsedLine(
    active: ActiveRun,
    stream: RawLogLine["stream"],
    line: string,
    rawLineId: number,
    timestamp: string,
  ): ParsedEvent {
    const parsed = parseLogLine({
      line,
      stream,
      seq: active.run.events.length + 1,
      timestamp,
      rawLineId,
      fallbackPhase: active.fallbackPhase,
    });

    if (parsed.phase !== "connect") {
      active.fallbackPhase = parsed.phase;
    }

    active.run.events.push(parsed);
    this.notify(active.run);
    return parsed;
  }

  private appendChunk(active: ActiveRun, stream: "stdout" | "stderr", chunk: string): void {
    const splitChunk = (text: string): { lines: string[]; remainder: string } => {
      const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const parts = normalized.split("\n");
      return {
        lines: parts.slice(0, -1),
        remainder: parts[parts.length - 1] ?? "",
      };
    };

    const raw = this.appendRawLog(active, stream, chunk);
    if (stream === "stdout") {
      active.lastStdoutRawId = raw.id;
      active.lastStdoutRawTimestamp = raw.timestamp;
    } else {
      active.lastStderrRawId = raw.id;
      active.lastStderrRawTimestamp = raw.timestamp;
    }

    if (stream === "stdout") {
      const { lines, remainder } = splitChunk(active.stdoutRemainder + chunk);
      active.stdoutRemainder = remainder;
      for (const line of lines) {
        if (line.trim().length > 0) {
          this.appendParsedLine(active, "stdout", active.redactor.redact(line), raw.id, raw.timestamp);
        }
      }
      return;
    }

    const { lines, remainder } = splitChunk(active.stderrRemainder + chunk);
    active.stderrRemainder = remainder;
    for (const line of lines) {
      if (line.trim().length > 0) {
        this.appendParsedLine(active, "stderr", active.redactor.redact(line), raw.id, raw.timestamp);
      }
    }
  }

  private flushRemainders(active: ActiveRun): void {
    if (active.stdoutRemainder.trim().length > 0) {
      if (active.lastStdoutRawId && active.lastStdoutRawTimestamp) {
        this.appendParsedLine(
          active,
          "stdout",
          active.redactor.redact(active.stdoutRemainder),
          active.lastStdoutRawId,
          active.lastStdoutRawTimestamp,
        );
      } else {
        this.appendLine(active, "stdout", active.stdoutRemainder);
      }
    }
    if (active.stderrRemainder.trim().length > 0) {
      if (active.lastStderrRawId && active.lastStderrRawTimestamp) {
        this.appendParsedLine(
          active,
          "stderr",
          active.redactor.redact(active.stderrRemainder),
          active.lastStderrRawId,
          active.lastStderrRawTimestamp,
        );
      } else {
        this.appendLine(active, "stderr", active.stderrRemainder);
      }
    }
    active.stdoutRemainder = "";
    active.stderrRemainder = "";
  }

  private async finalize(active: ActiveRun, exitCode: number | null, signal?: string): Promise<void> {
    if (!this.active.has(active.run.id)) {
      return;
    }

    clearTimeout(active.timeoutHandle);
    this.flushRemainders(active);

    active.run.status = resolveStatus(exitCode, signal, active.cancelRequested, active.timedOut);
    active.run.exitCode = typeof exitCode === "number" ? exitCode : undefined;
    active.run.endedAt = new Date().toISOString();
    active.run.durationMs =
      new Date(active.run.endedAt).getTime() - new Date(active.run.startedAt).getTime();

    const { summary, nextActions } = summarizeRun(active.run);
    active.run.summary = summary;
    active.run.nextActions = nextActions;

    const finalEvent = this.appendLine(active, "system", summary);
    finalEvent.metadata = {
      startTime: active.run.startedAt,
      endTime: active.run.endedAt,
      durationMs: active.run.durationMs ?? 0,
      exitCode: active.run.exitCode ?? -1,
      status: active.run.status,
    };

    await this.persist(active.run);
    this.notify(active.run);
    this.active.delete(active.run.id);
  }

  async cancelRun(runId: string, reason: "user" | "timeout"): Promise<boolean> {
    const active = this.active.get(runId);
    if (!active) {
      return false;
    }

    active.cancelRequested = reason === "user";
    active.timedOut = reason === "timeout";
    this.appendLine(
      active,
      "system",
      reason === "timeout" ? "Run timed out. Interrupting command." : "Run cancellation requested by user.",
    );

    try {
      await active.cancel();
    } catch {
      // no-op
    }

    await this.finalize(
      active,
      reason === "timeout" ? 124 : 130,
      reason === "timeout" ? "SIGTERM" : "SIGINT",
    );
    return true;
  }

  async sendInput(runId: string, input: string): Promise<boolean> {
    const active = this.active.get(runId);
    if (!active) {
      return false;
    }
    try {
      await active.sendInput(input);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendLine(active, "system", `ERROR: failed to send input (${message})`);
      return false;
    }
  }

  async startRun(input: {
    target: TargetProfile;
    credentials: SshCredentials;
    type: RunType;
    command: string;
    timeoutMs: number;
    fallbackPhase: RunPhase;
    tool?: ToolName;
    action?: ToolAction;
    redactionValues?: string[];
  }): Promise<RunRecord> {
    const shouldLogConnection = input.type !== "command";
    const interactiveMode = input.type === "command";

    const run: RunRecord = {
      id: newId("run"),
      targetId: input.target.id,
      type: input.type,
      status: "connecting",
      tool: input.tool,
      action: input.action,
      command: input.command,
      startedAt: new Date().toISOString(),
      nextActions: [],
      events: [],
      rawLogs: [],
    };

    const active: ActiveRun = {
      run,
      fallbackPhase: input.fallbackPhase,
      redactor: new Redactor(input.redactionValues ?? []),
      cancelRequested: false,
      timedOut: false,
      cancel: async () => {
        // Assigned after SSH handle creation.
      },
      sendInput: async () => {
        // Assigned after SSH handle creation.
      },
      stdoutRemainder: "",
      stderrRemainder: "",
      lastStdoutRawId: undefined,
      lastStdoutRawTimestamp: undefined,
      lastStderrRawId: undefined,
      lastStderrRawTimestamp: undefined,
      timeoutHandle: interactiveMode
        ? undefined
        : setTimeout(() => {
            void this.cancelRun(run.id, "timeout");
          }, input.timeoutMs),
    };

    this.active.set(run.id, active);
    if (shouldLogConnection) {
      this.appendLine(active, "system", "SSH connection starting");
    }
    this.notify(run);
    await this.persist(run);

    // Launch SSH connection + command in the background so startRun returns
    // immediately. This lets callers subscribe via waitForTerminalRun before
    // the timeout fires, preventing a hang when SSH blocks (unreachable host).
    void (async () => {
      try {
        const handle = await this.ssh.runCommand(
          input.target,
          input.credentials,
          input.command,
          {
            onStdout: (chunk) => {
              if (!this.active.has(run.id)) {
                return;
              }
              if (active.run.status === "connecting") {
                active.run.status = "running";
                if (shouldLogConnection) {
                  this.appendLine(active, "system", "SSH connection established");
                }
              }
              this.appendChunk(active, "stdout", chunk);
              this.notify(active.run);
              void this.persist(active.run);
            },
            onStderr: (chunk) => {
              if (!this.active.has(run.id)) {
                return;
              }
              if (active.run.status === "connecting") {
                active.run.status = "running";
                if (shouldLogConnection) {
                  this.appendLine(active, "system", "SSH connection established");
                }
              }
              this.appendChunk(active, "stderr", chunk);
              this.notify(active.run);
              void this.persist(active.run);
            },
          },
          { mode: interactiveMode ? "interactive" : "scripted" },
        );

        // Run was already finalized by timeout while SSH was connecting — bail.
        if (!this.active.has(run.id)) {
          void handle.wait.catch(() => {});
          return;
        }

        active.cancel = handle.cancel;
        active.sendInput = handle.sendInput;
        if (active.run.status === "connecting") {
          active.run.status = "running";
          if (shouldLogConnection) {
            this.appendLine(active, "system", "SSH connection established");
          }
          this.notify(active.run);
          void this.persist(active.run);
        }

        handle.wait
          .then(async (result) => {
            await this.finalize(active, result.exitCode, result.signal);
          })
          .catch(async (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            this.appendLine(active, "system", `ERROR: ${message}`);
            await this.finalize(active, 1, "SIGTERM");
          });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.appendLine(active, "system", `ERROR: ${message}`);
        await this.finalize(active, 1, "SIGTERM");
      }
    })();

    return cloneRun(run);
  }
}
