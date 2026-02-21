import { ensureDaemon, isDaemonRunning, stopDaemon } from "./daemon.js";
import { sendCommand } from "./ipc.js";
import { readOutputLines, tailOutput } from "./outputStore.js";
import { loadState } from "./stateStore.js";
import { generateKeyPair } from "./keygen.js";
import { encodeQR } from "./qrText.js";
import type { IpcResponse, Tool } from "./types.js";

const DAEMON_VERSION = "0.1.1";

function usage(): never {
  console.log(`openvide-daemon — Persistent session manager for AI CLI tools

Usage:
  openvide-daemon version
  openvide-daemon health
  openvide-daemon session create --tool <claude|codex|gemini> --cwd <path> [--model <model>] [--auto-accept] [--conversation-id <id>]
  openvide-daemon session send --id <id> --prompt <prompt>
  openvide-daemon session stream --id <id> [--offset <n>] [--follow]
  openvide-daemon session cancel --id <id>
  openvide-daemon session list
  openvide-daemon session list-native --cwd <path> [--tool <claude|codex|all>]
  openvide-daemon session list-workspace --cwd <path>
  openvide-daemon session get --id <id>
  openvide-daemon session history --id <id> [--limit-lines <n>]
  openvide-daemon session history --tool <claude|codex> --resume-id <id> [--cwd <path>] [--limit-lines <n>]
  openvide-daemon session wait-idle --id <id> [--timeout-ms <n>]
  openvide-daemon session remove --id <id>
  openvide-daemon keygen [--comment <c>] [--host <h>] [--port <p>] [--username <u>]
  openvide-daemon stop`);
  process.exit(1);
}

function parseArgs(argv: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        map.set(key, next);
        i++;
      } else {
        map.set(key, "true");
      }
    }
  }
  return map;
}

function printJson(obj: unknown): void {
  console.log(JSON.stringify(obj));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const command = args[0];

  // ── version ──
  if (command === "version") {
    printJson({ ok: true, version: DAEMON_VERSION });
    return;
  }

  // ── stop ──
  if (command === "stop") {
    if (isDaemonRunning()) {
      // Try graceful IPC stop first
      try {
        const res = await sendCommand({ cmd: "stop" });
        printJson(res);
        return;
      } catch {
        // Fallback to signal
        stopDaemon();
        printJson({ ok: true });
        return;
      }
    }
    printJson({ ok: true, message: "Daemon not running" });
    return;
  }

  // ── health ──
  if (command === "health") {
    ensureDaemon();
    const res = await sendCommand({ cmd: "health" });
    printJson(res);
    return;
  }

  // ── keygen ──
  if (command === "keygen") {
    const flags = parseArgs(args.slice(1));
    const comment = flags.get("comment") ?? "openvide-daemon-keygen";
    const host = flags.get("host") ?? "localhost";
    const port = parseInt(flags.get("port") ?? "22", 10);
    const username = flags.get("username") ?? process.env.USER ?? "root";

    const result = generateKeyPair(comment);
    // Compact payload: short keys + raw seed (44 chars) instead of full PEM (~120 chars)
    // This keeps the QR small enough to scan from a phone screen
    const payload = JSON.stringify({
      v: 1,
      h: host,
      p: port,
      u: username,
      k: result.seed,
    });

    // Print QR to stderr (visible in terminal)
    const qrLines = encodeQR(payload);
    for (const line of qrLines) {
      process.stderr.write(line + "\n");
    }
    process.stderr.write(`\nFingerprint: ${result.fingerprint}\n`);
    process.stderr.write(`Public key added to ~/.ssh/authorized_keys\n`);
    process.stderr.write(`Scan the QR code above with the OpenVide app to connect.\n\n`);

    // Print JSON to stdout (machine consumption)
    printJson({
      ok: true,
      host,
      port,
      username,
      fingerprint: result.fingerprint,
      publicKey: result.publicKey,
      privateKey: result.privateKey,
    });
    return;
  }

  // ── session subcommands ──
  if (command === "session") {
    const sub = args[1];
    if (!sub) usage();

    const flags = parseArgs(args.slice(2));

    switch (sub) {
      case "create": {
        const tool = flags.get("tool") as Tool | undefined;
        const cwd = flags.get("cwd");
        if (!tool || !cwd) {
          console.error("Error: --tool and --cwd are required");
          process.exit(1);
        }
        ensureDaemon();
        const res = await sendCommand({
          cmd: "session.create",
          tool,
          cwd,
          model: flags.get("model"),
          autoAccept: flags.has("auto-accept") ? true : undefined,
          conversationId: flags.get("conversation-id"),
        });
        printJson(res);
        return;
      }

      case "send": {
        const id = flags.get("id");
        const prompt = flags.get("prompt");
        if (!id || !prompt) {
          console.error("Error: --id and --prompt are required");
          process.exit(1);
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "session.send", id, prompt });
        printJson(res);
        return;
      }

      case "stream": {
        const id = flags.get("id");
        if (!id) {
          console.error("Error: --id is required");
          process.exit(1);
        }
        const offset = parseInt(flags.get("offset") ?? "0", 10);
        const follow = flags.has("follow");

        if (!follow) {
          // One-shot read
          const lines = readOutputLines(id, offset);
          for (const line of lines) {
            console.log(line);
          }
          return;
        }

        // Follow mode — read directly from JSONL, no IPC
        const ac = new AbortController();
        process.on("SIGINT", () => ac.abort());
        process.on("SIGTERM", () => ac.abort());

        await tailOutput(
          id,
          offset,
          (line) => console.log(line),
          () => {
            // Check if session is in terminal state
            const state = loadState();
            const session = state.sessions[id];
            if (!session) return true;
            return session.status !== "running";
          },
          ac.signal,
        );
        return;
      }

      case "cancel": {
        const id = flags.get("id");
        if (!id) {
          console.error("Error: --id is required");
          process.exit(1);
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "session.cancel", id });
        printJson(res);
        return;
      }

      case "list": {
        ensureDaemon();
        const res = await sendCommand({ cmd: "session.list" });
        printJson(res);
        return;
      }

      case "list-native": {
        const cwd = flags.get("cwd");
        const tool = flags.get("tool");
        if (!cwd) {
          console.error("Error: --cwd is required");
          process.exit(1);
        }
        if (tool && tool !== "claude" && tool !== "codex" && tool !== "all") {
          console.error("Error: --tool must be one of claude|codex|all");
          process.exit(1);
        }
        ensureDaemon();
        const res = await sendCommand({
          cmd: "session.list_native",
          cwd,
          tool: tool ?? "all",
        });
        printJson(res);
        return;
      }

      case "list-workspace": {
        const cwd = flags.get("cwd");
        if (!cwd) {
          console.error("Error: --cwd is required");
          process.exit(1);
        }
        ensureDaemon();
        const res = await sendCommand({
          cmd: "session.list_workspace",
          cwd,
        });
        printJson(res);
        return;
      }

      case "get": {
        const id = flags.get("id");
        if (!id) {
          console.error("Error: --id is required");
          process.exit(1);
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "session.get", id });
        printJson(res);
        return;
      }

      case "history": {
        const id = flags.get("id");
        const tool = flags.get("tool");
        const resumeId = flags.get("resume-id");
        const cwd = flags.get("cwd");
        const limitRaw = flags.get("limit-lines");
        const limitLines = limitRaw ? parseInt(limitRaw, 10) : undefined;

        if (!id && (!tool || !resumeId)) {
          console.error("Error: provide --id or (--tool and --resume-id)");
          process.exit(1);
        }
        if (tool && tool !== "claude" && tool !== "codex") {
          console.error("Error: --tool must be claude or codex");
          process.exit(1);
        }

        ensureDaemon();
        const res = await sendCommand({
          cmd: "session.history",
          id,
          tool,
          resumeId,
          cwd,
          limitLines,
        });
        printJson(res);
        return;
      }

      case "wait-idle": {
        const id = flags.get("id");
        if (!id) {
          console.error("Error: --id is required");
          process.exit(1);
        }
        const timeoutRaw = flags.get("timeout-ms");
        const timeoutMs = timeoutRaw ? parseInt(timeoutRaw, 10) : undefined;
        ensureDaemon();
        const res = await sendCommand({ cmd: "session.wait_idle", id, timeoutMs });
        printJson(res);
        return;
      }

      case "remove": {
        const id = flags.get("id");
        if (!id) {
          console.error("Error: --id is required");
          process.exit(1);
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "session.remove", id });
        printJson(res);
        return;
      }

      default:
        console.error(`Unknown session subcommand: ${sub}`);
        usage();
    }
  }

  console.error(`Unknown command: ${command}`);
  usage();
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
