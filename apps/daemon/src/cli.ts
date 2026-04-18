import * as os from "node:os";
import { ensureDaemon, isDaemonRunning, stopDaemon, runDaemonMain } from "./daemon.js";
import { sendCommand } from "./ipc.js";
import { readOutputLines, tailOutput } from "./outputStore.js";
import { loadState } from "./stateStore.js";
import { generateKeyPair } from "./keygen.js";
import { encodeQR } from "./qrText.js";
import { tryCacheClaudeAuth } from "./authCache.js";
import { generateDeployScaffold, type DeployProxy } from "./deployScaffold.js";
import { runDeployDoctor, runDeploySetup } from "./deployManager.js";
import type { IpcRequest, IpcResponse, Tool } from "./types.js";

const DAEMON_VERSION = "0.2.3";

function detectTailscaleIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const parts = addr.address.split(".").map(Number);
      if (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) {
        return addr.address;
      }
    }
  }
  return null;
}
const LONG_IPC_TIMEOUT_MS = 60000;

function usage(): never {
  console.log(`openvide-daemon — Persistent session manager for AI CLI tools

Usage:
  openvide-daemon version
  openvide-daemon run
  openvide-daemon health
  openvide-daemon session create --tool <claude|codex|gemini> --cwd <path> [--model <model>] [--auto-accept] [--conversation-id <id>]
  openvide-daemon session send --id <id> --prompt <prompt>
  openvide-daemon session stream --id <id> [--offset <n>] [--follow]
  openvide-daemon session cancel --id <id>
  openvide-daemon session list
  openvide-daemon session catalog
  openvide-daemon session list-native --cwd <path> [--tool <claude|codex|all>]
  openvide-daemon session list-workspace --cwd <path>
  openvide-daemon session get --id <id>
  openvide-daemon session suggest --id <id> [--limit <n>]
  openvide-daemon session history --id <id> [--limit-lines <n>]
  openvide-daemon session history --tool <claude|codex> --resume-id <id> [--cwd <path>] [--limit-lines <n>]
  openvide-daemon session wait-idle --id <id> [--timeout-ms <n>]
  openvide-daemon session remove --id <id>
  openvide-daemon model list --tool <codex>
  openvide-daemon config set-push-token --token <token>
  openvide-daemon prompt list
  openvide-daemon prompt add --label <label> --prompt <text>
  openvide-daemon prompt remove --id <id>
  openvide-daemon bridge enable [--port 7842] [--no-tls]
  openvide-daemon bridge disable
  openvide-daemon bridge status
  openvide-daemon bridge token [--expire 24h]
  openvide-daemon bridge revoke --jti <jti>
  openvide-daemon bridge qr [--expire 24h] [--host <host>]
  openvide-daemon bridge config [--bind-host <host>] [--default-cwd <path>] [--even-ai-tool claude|codex|gemini] [--even-ai-mode new|last|pinned] [--even-ai-pin-session <id>]
  openvide-daemon deploy scaffold [--proxy caddy|nginx|none] [--domain <domain>] [--public-origin <origin>] [--email <email>] [--output <dir>] [--service-name <name>] [--daemon-user <user>] [--bridge-port <n>] [--bind-host <host>] [--default-cwd <path>] [--even-ai-tool claude|codex|gemini] [--even-ai-mode new|last|pinned]
  openvide-daemon deploy doctor [--proxy caddy|nginx|none] [--domain <domain>] [--public-origin <origin>] [--output <dir>] [--service-name <name>] [--daemon-user <user>] [--bridge-port <n>] [--bind-host <host>] [--default-cwd <path>] [--even-ai-tool claude|codex|gemini] [--even-ai-mode new|last|pinned]
  openvide-daemon deploy setup [--proxy caddy|nginx|none] [--domain <domain>] [--public-origin <origin>] [--email <email>] [--output <dir>] [--service-name <name>] [--daemon-user <user>] [--bridge-port <n>] [--bind-host <host>] [--default-cwd <path>] [--even-ai-tool claude|codex|gemini] [--even-ai-mode new|last|pinned] [--issue-token] [--token-expire 24h] [--dry-run]
  openvide-daemon schedule list
  openvide-daemon schedule get --id <id>
  openvide-daemon schedule create --name <name> --schedule <cron> [--project <name>] [--enabled true|false] (--target-json <json> | (--target-kind prompt --tool <claude|codex|gemini> --cwd <path> --prompt <text> [--model <model>] [--mode <mode>]) | (--target-kind team --team-id <id> --prompt <text> [--to <member|*>]))
  openvide-daemon schedule update --id <id> [--name <name>] [--schedule <cron>] [--project <name>] [--enabled true|false] [--target-json <json>]
  openvide-daemon schedule delete --id <id>
  openvide-daemon schedule run --task-id <id>
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

function failJson(error: string): never {
  printJson({ ok: false, error });
  process.exit(1);
}

function parseJsonFlag<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    failJson(`${label} must be valid JSON`);
  }
}

function parseBooleanFlag(raw: string | undefined, label: string): boolean | undefined {
  if (raw == null) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  failJson(`${label} must be true or false`);
}

function buildScheduleTarget(flags: Map<string, string>): Record<string, unknown> {
  const targetJson = flags.get("target-json");
  if (targetJson) {
    return parseJsonFlag<Record<string, unknown>>(targetJson, "--target-json");
  }

  const kind = flags.get("target-kind") ?? "prompt";
  const prompt = flags.get("prompt");
  if (!prompt) failJson("--prompt is required");

  if (kind === "team") {
    const teamId = flags.get("team-id");
    if (!teamId) failJson("--team-id is required for team schedules");
    return {
      kind: "team",
      teamId,
      prompt,
      to: flags.get("to") ?? "*",
    };
  }

  if (kind !== "prompt") failJson("--target-kind must be prompt or team");
  const tool = flags.get("tool");
  const cwd = flags.get("cwd");
  if (!tool || !cwd) failJson("--tool and --cwd are required for prompt schedules");
  return {
    kind: "prompt",
    tool,
    cwd,
    prompt,
    model: flags.get("model"),
    mode: flags.get("mode"),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  // Opportunistically cache Claude auth credentials from macOS Keychain.
  // Succeeds when CLI runs in a session with Keychain access (local terminal).
  // This ensures the daemon can authenticate even when started from SSH.
  tryCacheClaudeAuth();

  const command = args[0];

  // ── version ──
  if (command === "version") {
    printJson({ ok: true, version: DAEMON_VERSION });
    return;
  }

  // ── run (foreground daemon, for systemd/managed services) ──
  if (command === "run") {
    runDaemonMain();
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
    const explicitHost = flags.get("host");
    const tsIp = detectTailscaleIp();
    const host = explicitHost ?? tsIp ?? undefined;
    const portStr = flags.get("port");
    const port = portStr ? parseInt(portStr, 10) : undefined;
    const username = flags.get("username");

    const result = generateKeyPair(comment);
    // Compact payload: only key is required, host/port/username are optional auto-fill
    const qrData: Record<string, unknown> = { v: 1, k: result.seed };
    if (host) qrData.h = host;
    if (port) qrData.p = port;
    if (username) qrData.u = username;
    const payload = JSON.stringify(qrData);

    // Print QR to stderr (visible in terminal)
    const qrLines = await encodeQR(payload);
    for (const line of qrLines) {
      process.stderr.write(line + "\n");
    }
    process.stderr.write(`\nFingerprint: ${result.fingerprint}\n`);
    process.stderr.write(`Public key added to ~/.ssh/authorized_keys\n`);
    if (tsIp && !explicitHost) {
      process.stderr.write(`Tailscale detected: QR uses ${tsIp}\n`);
    }
    process.stderr.write(`Scan the QR code above with the OpenVide app to connect.\n\n`);

    // Print JSON to stdout (machine consumption)
    printJson({
      ok: true,
      ...(host ? { host } : {}),
      ...(port ? { port } : {}),
      ...(username ? { username } : {}),
      fingerprint: result.fingerprint,
      publicKey: result.publicKey,
      privateKey: result.privateKey,
    });
    return;
  }

  // ── config subcommands ──
  if (command === "config") {
    const sub = args[1];
    if (!sub) failJson("Missing config subcommand");

    const flags = parseArgs(args.slice(2));

    switch (sub) {
      case "set-push-token": {
        const token = flags.get("token");
        if (!token) {
          failJson("--token is required");
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "config.setPushToken", token });
        printJson(res);
        return;
      }

      default:
        failJson(`Unknown config subcommand: ${sub}`);
    }
  }

  // ── bridge subcommands ──
  if (command === "bridge") {
    const sub = args[1];
    if (!sub) failJson("Missing bridge subcommand");

    const flags = parseArgs(args.slice(2));

    switch (sub) {
      case "enable": {
        ensureDaemon();
        const portStr = flags.get("port");
        const port = portStr ? parseInt(portStr, 10) : 7842;
        const tls = !flags.has("no-tls"); // default: TLS on (auto-uses Tailscale cert if available)
        const res = await sendCommand({ cmd: "bridge.enable", port, tls });
        printJson(res);

        if (res.ok) {
          process.stderr.write(`Bridge started on port ${port}${tls ? "" : " (no TLS)"}\n`);
        }
        return;
      }

      case "disable": {
        ensureDaemon();
        const res = await sendCommand({ cmd: "bridge.disable" });
        printJson(res);
        if (res.ok) {
          process.stderr.write("Bridge disabled\n");
        }
        return;
      }

      case "status": {
        ensureDaemon();
        const res = await sendCommand({ cmd: "bridge.status" });
        printJson(res);
        return;
      }

      case "token": {
        ensureDaemon();
        const expire = flags.get("expire") ?? "24h";
        const res = await sendCommand({ cmd: "bridge.token.create", expire }) as IpcResponse & Record<string, unknown>;
        printJson(res);
        if (res.ok && res.bridgeToken) {
          process.stderr.write(`\nToken: ${res.bridgeToken as string}\n`);
          if (res.bridgeUrl) {
            process.stderr.write(`Local:     ${res.bridgeUrl as string}\n`);
          }
          if (res.tailscaleUrl) {
            process.stderr.write(`Tailscale: ${res.tailscaleUrl as string}\n`);
          }
          process.stderr.write(`\n`);
        }
        return;
      }

      case "revoke": {
        const jti = flags.get("jti");
        if (!jti) failJson("--jti is required");
        ensureDaemon();
        const res = await sendCommand({ cmd: "bridge.token.revoke", jti });
        printJson(res);
        return;
      }

      case "qr": {
        ensureDaemon();
        const expire = flags.get("expire") ?? "24h";
        const host = flags.get("host");
        const res = await sendCommand({ cmd: "bridge.qr", expire, host });
        printJson(res);

        if (res.ok && res.qrLines) {
          for (const line of res.qrLines) {
            process.stderr.write(line + "\n");
          }
          if (res.bridgeUrl) {
            process.stderr.write(`\nURL: ${res.bridgeUrl}\n`);
          }
          process.stderr.write("Scan the QR code above with the Even glasses app to connect.\n\n");
        }
        return;
      }

      case "config": {
        ensureDaemon();
        const configReq: IpcRequest = { cmd: "bridge.config" };
        const bindHost = flags.get("bind-host");
        if (bindHost) (configReq as Record<string, unknown>).bindHost = bindHost;
        const defaultCwd = flags.get("default-cwd");
        if (defaultCwd) (configReq as Record<string, unknown>).defaultCwd = defaultCwd;
        const evenAiTool = flags.get("even-ai-tool");
        if (evenAiTool) (configReq as Record<string, unknown>).evenAiTool = evenAiTool;
        const evenAiMode = flags.get("even-ai-mode");
        if (evenAiMode) (configReq as Record<string, unknown>).evenAiMode = evenAiMode;
        const pinSession = flags.get("even-ai-pin-session");
        if (pinSession) (configReq as Record<string, unknown>).evenAiPinnedSessionId = pinSession;
        const res = await sendCommand(configReq);
        printJson(res);
        return;
      }

      default:
        failJson(`Unknown bridge subcommand: ${sub}`);
    }
  }

  // ── prompt subcommands ──
  if (command === "prompt") {
    const sub = args[1];
    if (!sub) failJson("Missing prompt subcommand");

    const flags = parseArgs(args.slice(2));

    switch (sub) {
      case "list": {
        ensureDaemon();
        const res = await sendCommand({ cmd: "prompt.list" });
        printJson(res);
        return;
      }

      case "add": {
        const label = flags.get("label");
        const prompt = flags.get("prompt");
        if (!label || !prompt) {
          failJson("--label and --prompt are required");
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "prompt.add", label, prompt });
        printJson(res);
        return;
      }

      case "remove": {
        const id = flags.get("id");
        if (!id) {
          failJson("--id is required");
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "prompt.remove", id });
        printJson(res);
        return;
      }

      default:
        failJson(`Unknown prompt subcommand: ${sub}`);
    }
  }

  // ── deploy subcommands ──
  if (command === "deploy") {
    const sub = args[1];
    if (!sub) failJson("Missing deploy subcommand");

    const flags = parseArgs(args.slice(2));

    const proxyRaw = flags.get("proxy") ?? "caddy";
    if (proxyRaw !== "caddy" && proxyRaw !== "nginx" && proxyRaw !== "none") {
      failJson("--proxy must be caddy, nginx, or none");
    }
    const proxy = proxyRaw as DeployProxy;
    const domain = flags.get("domain");
    const publicOrigin = flags.get("public-origin");
    if (proxy !== "none" && !domain && !publicOrigin) {
      failJson("--domain is required for caddy/nginx modes unless --public-origin is set");
    }
    const outputDir = flags.get("output") ?? "./openvide-deploy";
    const serviceName = flags.get("service-name") ?? "openvide-daemon";
    const daemonUser = flags.get("daemon-user") ?? os.userInfo().username;
    const bridgePortRaw = flags.get("bridge-port");
    const bridgePort = bridgePortRaw ? parseInt(bridgePortRaw, 10) : 7842;
    if (!Number.isFinite(bridgePort) || bridgePort <= 0) {
      failJson("--bridge-port must be a positive integer");
    }
    const bindHost = flags.get("bind-host")
      ?? (proxy === "none" ? "::" : "127.0.0.1");
    const evenAiTool = flags.get("even-ai-tool");
    if (evenAiTool && evenAiTool !== "claude" && evenAiTool !== "codex" && evenAiTool !== "gemini") {
      failJson("--even-ai-tool must be claude, codex, or gemini");
    }
    const evenAiMode = flags.get("even-ai-mode");
    if (evenAiMode && evenAiMode !== "new" && evenAiMode !== "last" && evenAiMode !== "pinned") {
      failJson("--even-ai-mode must be new, last, or pinned");
    }

    const commonOpts = {
      outputDir,
      domain,
      publicOrigin,
      email: flags.get("email"),
      proxy,
      serviceName,
      daemonUser,
      bridgePort,
      bindHost,
      defaultCwd: flags.get("default-cwd"),
      evenAiTool: evenAiTool as "claude" | "codex" | "gemini" | undefined,
      evenAiMode: evenAiMode as "new" | "last" | "pinned" | undefined,
    };

    switch (sub) {
      case "scaffold": {
        const result = generateDeployScaffold(commonOpts);

        printJson({
          ok: true,
          rootDir: result.rootDir,
          files: result.files,
        });
        return;
      }

      case "doctor": {
        const result = await runDeployDoctor(commonOpts);
        printJson({ ok: result.ok, rootDir: result.rootDir, publicOrigin: result.publicOrigin, checks: result.checks });
        return;
      }

      case "setup": {
        const result = runDeploySetup({
          ...commonOpts,
          dryRun: flags.has("dry-run"),
          issueToken: flags.has("issue-token"),
          tokenExpire: flags.get("token-expire") ?? "24h",
        });
        printJson({ ok: true, ...result });
        return;
      }

      default:
        failJson(`Unknown deploy subcommand: ${sub}`);
    }
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
          failJson("--tool and --cwd are required");
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
          failJson("--id and --prompt are required");
        }
        const sendT0 = Date.now();
        process.stderr.write(`[ov-cli] send: id=${id} prompt=${prompt.slice(0, 40)}...\n`);
        ensureDaemon();
        process.stderr.write(`[ov-cli] send: daemon ready +${Date.now() - sendT0}ms\n`);
        const res = await sendCommand({
          cmd: "session.send",
          id,
          prompt,
          mode: flags.get("mode"),
          model: flags.get("model"),
        });
        process.stderr.write(`[ov-cli] send: IPC returned +${Date.now() - sendT0}ms ok=${(res as unknown as Record<string, unknown>)["ok"]}\n`);
        printJson(res);
        return;
      }

      case "stream": {
        const id = flags.get("id");
        if (!id) {
          failJson("--id is required");
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
          failJson("--id is required");
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

      case "catalog": {
        ensureDaemon();
        const res = await sendCommand({ cmd: "session.catalog" }, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      case "list-native": {
        const cwd = flags.get("cwd");
        const tool = flags.get("tool");
        if (!cwd) {
          failJson("--cwd is required");
        }
        if (tool && tool !== "claude" && tool !== "codex" && tool !== "all") {
          failJson("--tool must be one of claude|codex|all");
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
          failJson("--cwd is required");
        }
        ensureDaemon();
        const res = await sendCommand({
          cmd: "session.list_workspace",
          cwd,
        }, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      case "get": {
        const id = flags.get("id");
        if (!id) {
          failJson("--id is required");
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "session.get", id });
        printJson(res);
        return;
      }

      case "suggest": {
        const id = flags.get("id");
        if (!id) {
          failJson("--id is required");
        }
        const limitRaw = flags.get("limit");
        const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
        if (limitRaw && (!Number.isFinite(limit) || (limit ?? 0) <= 0)) {
          failJson("--limit must be a positive integer");
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "session.suggest", id, limit }, LONG_IPC_TIMEOUT_MS);
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
          failJson("provide --id or (--tool and --resume-id)");
        }
        if (tool && tool !== "claude" && tool !== "codex") {
          failJson("--tool must be claude or codex");
        }

        ensureDaemon();
        const res = await sendCommand({
          cmd: "session.history",
          id,
          tool,
          resumeId,
          cwd,
          limitLines,
        }, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      case "wait-idle": {
        const id = flags.get("id");
        if (!id) {
          failJson("--id is required");
        }
        const timeoutRaw = flags.get("timeout-ms");
        const timeoutMs = timeoutRaw ? parseInt(timeoutRaw, 10) : undefined;
        ensureDaemon();
        const ipcTimeout = Math.max(LONG_IPC_TIMEOUT_MS, (timeoutMs ?? 30000) + 5000);
        const res = await sendCommand({ cmd: "session.wait_idle", id, timeoutMs }, ipcTimeout);
        printJson(res);
        return;
      }

      case "remove": {
        const id = flags.get("id");
        if (!id) {
          failJson("--id is required");
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "session.remove", id });
        printJson(res);
        return;
      }

      case "remote": {
        const id = flags.get("id");
        if (!id) {
          failJson("--id is required");
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "session.remote", id }, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      default:
        failJson(`Unknown session subcommand: ${sub}`);
    }
  }

  // ── schedule subcommands ──
  if (command === "schedule") {
    const sub = args[1];
    if (!sub) failJson("Missing schedule subcommand");

    const flags = parseArgs(args.slice(2));

    switch (sub) {
      case "list": {
        ensureDaemon();
        const res = await sendCommand({ cmd: "schedule.list" }, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      case "get": {
        const id = flags.get("id");
        if (!id) failJson("--id is required");
        ensureDaemon();
        const res = await sendCommand({ cmd: "schedule.get", id }, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      case "create": {
        const name = flags.get("name");
        const schedule = flags.get("schedule");
        if (!name || !schedule) failJson("--name and --schedule are required");
        const target = buildScheduleTarget(flags);
        const enabled = parseBooleanFlag(flags.get("enabled"), "--enabled");
        ensureDaemon();
        const res = await sendCommand({
          cmd: "schedule.create",
          name,
          schedule,
          project: flags.get("project"),
          enabled,
          target,
        }, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      case "update": {
        const id = flags.get("id");
        if (!id) failJson("--id is required");
        const req: IpcRequest = { cmd: "schedule.update", id };
        if (flags.has("name")) req.name = flags.get("name");
        if (flags.has("schedule")) req.schedule = flags.get("schedule");
        if (flags.has("project")) req.project = flags.get("project");
        const enabled = parseBooleanFlag(flags.get("enabled"), "--enabled");
        if (enabled !== undefined) req.enabled = enabled;
        if (flags.has("target-json") || flags.has("target-kind")) {
          req.target = buildScheduleTarget(flags);
        }
        ensureDaemon();
        const res = await sendCommand(req, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      case "delete": {
        const id = flags.get("id");
        if (!id) failJson("--id is required");
        ensureDaemon();
        const res = await sendCommand({ cmd: "schedule.delete", id }, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      case "run": {
        const taskId = flags.get("task-id");
        if (!taskId) failJson("--task-id is required");
        ensureDaemon();
        const res = await sendCommand({ cmd: "schedule.run", taskId }, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      default:
        failJson(`Unknown schedule subcommand: ${sub}`);
    }
  }

  // ── model subcommands ──
  if (command === "model") {
    const sub = args[1];
    if (!sub) usage();
    const flags = parseArgs(args.slice(2));

    switch (sub) {
      case "list": {
        const tool = flags.get("tool");
        if (tool !== "codex") {
          failJson("--tool must be codex");
        }
        ensureDaemon();
        const res = await sendCommand({ cmd: "model.list", tool }, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      default:
        failJson(`Unknown model subcommand: ${sub}`);
    }
  }

  // ── team subcommands ──
  if (command === "team") {
    const sub = args[1];
    if (!sub) failJson("Missing team subcommand");

    const flags = parseArgs(args.slice(2));

    switch (sub) {
      case "create": {
        const name = flags.get("name");
        const cwd = flags.get("cwd");
        const membersJson = flags.get("members");
        if (!name || !cwd || !membersJson) failJson("--name, --cwd, and --members are required");
        let members: unknown[];
        try { members = JSON.parse(membersJson); } catch { failJson("--members must be valid JSON array"); return; }
        ensureDaemon();
        const res = await sendCommand({ cmd: "team.create", name, cwd, members }, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      case "list": {
        ensureDaemon();
        const res = await sendCommand({ cmd: "team.list" });
        printJson(res);
        return;
      }

      case "get": {
        const teamId = flags.get("team-id") ?? flags.get("id");
        if (!teamId) failJson("--id is required");
        ensureDaemon();
        const res = await sendCommand({ cmd: "team.get", teamId });
        printJson(res);
        return;
      }

      case "update": {
        const teamId = flags.get("team-id") ?? flags.get("id");
        if (!teamId) failJson("--id is required");
        const req: IpcRequest = { cmd: "team.update", teamId };
        if (flags.has("name")) (req as Record<string, unknown>).name = flags.get("name");
        if (flags.has("cwd")) (req as Record<string, unknown>).cwd = flags.get("cwd");
        if (flags.has("members")) {
          try {
            (req as Record<string, unknown>).members = JSON.parse(flags.get("members")!);
          } catch {
            failJson("--members must be valid JSON array");
          }
        }
        ensureDaemon();
        const res = await sendCommand(req, LONG_IPC_TIMEOUT_MS);
        printJson(res);
        return;
      }

      case "delete": {
        const teamId = flags.get("team-id") ?? flags.get("id");
        if (!teamId) failJson("--id is required");
        ensureDaemon();
        const res = await sendCommand({ cmd: "team.delete", teamId });
        printJson(res);
        return;
      }

      case "task": {
        const taskSub = args[2];
        if (!taskSub) failJson("Missing team task subcommand");
        const taskFlags = parseArgs(args.slice(3));

        switch (taskSub) {
          case "create": {
            const teamId = taskFlags.get("team-id");
            const subject = taskFlags.get("subject");
            const owner = taskFlags.get("owner");
            if (!teamId || !subject || !owner) failJson("--team-id, --subject, and --owner are required");
            ensureDaemon();
            const res = await sendCommand({
              cmd: "team.task.create",
              teamId,
              subject,
              description: taskFlags.get("description") ?? "",
              owner,
              dependencies: taskFlags.get("dependencies") ? JSON.parse(taskFlags.get("dependencies")!) : undefined,
            });
            printJson(res);
            return;
          }

          case "list": {
            const teamId = taskFlags.get("team-id");
            if (!teamId) failJson("--team-id is required");
            ensureDaemon();
            const res = await sendCommand({ cmd: "team.task.list", teamId });
            printJson(res);
            return;
          }

          case "update": {
            const teamId = taskFlags.get("team-id");
            const taskId = taskFlags.get("task-id");
            if (!teamId || !taskId) failJson("--team-id and --task-id are required");
            ensureDaemon();
            const req: IpcRequest = { cmd: "team.task.update", teamId, taskId };
            if (taskFlags.has("status")) (req as Record<string, unknown>).status = taskFlags.get("status");
            if (taskFlags.has("owner")) (req as Record<string, unknown>).owner = taskFlags.get("owner");
            const res = await sendCommand(req);
            printJson(res);
            return;
          }

          case "comment": {
            const teamId = taskFlags.get("team-id");
            const taskId = taskFlags.get("task-id");
            const text = taskFlags.get("text");
            if (!teamId || !taskId || !text) failJson("--team-id, --task-id, and --text are required");
            ensureDaemon();
            const res = await sendCommand({
              cmd: "team.task.comment",
              teamId,
              taskId,
              author: taskFlags.get("author") ?? "user",
              text,
            });
            printJson(res);
            return;
          }

          default:
            failJson(`Unknown team task subcommand: ${taskSub}`);
        }
        return;
      }

      case "message": {
        const msgSub = args[2];
        if (!msgSub) failJson("Missing team message subcommand");
        const msgFlags = parseArgs(args.slice(3));

        switch (msgSub) {
          case "send": {
            const teamId = msgFlags.get("team-id");
            const text = msgFlags.get("text");
            if (!teamId || !text) failJson("--team-id and --text are required");
            ensureDaemon();
            const res = await sendCommand({
              cmd: "team.message.send",
              teamId,
              from: msgFlags.get("from") ?? "user",
              to: msgFlags.get("to") ?? "*",
              text,
            });
            printJson(res);
            return;
          }

          case "list": {
            const teamId = msgFlags.get("team-id");
            if (!teamId) failJson("--team-id is required");
            ensureDaemon();
            const limitRaw = msgFlags.get("limit");
            const res = await sendCommand({
              cmd: "team.message.list",
              teamId,
              limit: limitRaw ? parseInt(limitRaw, 10) : undefined,
            });
            printJson(res);
            return;
          }

          default:
            failJson(`Unknown team message subcommand: ${msgSub}`);
        }
        return;
      }

      case "plan": {
        const planSub = args[2];
        if (!planSub) failJson("Missing team plan subcommand");
        const planFlags = parseArgs(args.slice(3));

        switch (planSub) {
          case "submit": {
            const teamId = planFlags.get("team-id");
            const planJson = planFlags.get("plan")
              ?? (planFlags.get("tasks") ? JSON.stringify({ tasks: parseJsonFlag<unknown[]>(planFlags.get("tasks")!, "--tasks") }) : undefined);
            if (!teamId || !planJson) failJson("--team-id and --plan are required");
            let plan: { tasks: unknown[] };
            try { plan = JSON.parse(planJson); } catch { failJson("--plan must be valid JSON"); return; }
            ensureDaemon();
            const res = await sendCommand({
              cmd: "team.plan.submit",
              teamId,
              plan,
              createdBy: planFlags.get("created-by") ?? "user",
              mode: planFlags.get("mode"),
              reviewers: planFlags.get("reviewers") ? JSON.parse(planFlags.get("reviewers")!) : undefined,
              maxIterations: planFlags.has("max-iterations") ? parseInt(planFlags.get("max-iterations")!, 10) : undefined,
            }, LONG_IPC_TIMEOUT_MS);
            printJson(res);
            return;
          }

          case "revise": {
            const teamId = planFlags.get("team-id");
            const planId = planFlags.get("plan-id");
            const revisionJson = planFlags.get("revision");
            const author = planFlags.get("author") ?? "user";
            if (!teamId || !planId || !revisionJson) failJson("--team-id, --plan-id, and --revision are required");
            let revision: { tasks: unknown[] };
            try { revision = JSON.parse(revisionJson); } catch { failJson("--revision must be valid JSON"); return; }
            ensureDaemon();
            const res = await sendCommand({
              cmd: "team.plan.revise",
              teamId,
              planId,
              author,
              revision,
            }, LONG_IPC_TIMEOUT_MS);
            printJson(res);
            return;
          }

          case "generate": {
            const teamId = planFlags.get("team-id");
            const request = planFlags.get("request");
            if (!teamId || !request) failJson("--team-id and --request are required");
            ensureDaemon();
            const res = await sendCommand({
              cmd: "team.plan.generate",
              teamId,
              request,
              mode: planFlags.get("mode"),
              reviewers: planFlags.get("reviewers") ? JSON.parse(planFlags.get("reviewers")!) : undefined,
              maxIterations: planFlags.has("max-iterations") ? parseInt(planFlags.get("max-iterations")!, 10) : undefined,
            }, LONG_IPC_TIMEOUT_MS);
            printJson(res);
            return;
          }

          case "review": {
            const teamId = planFlags.get("team-id");
            const planId = planFlags.get("plan-id");
            const vote = planFlags.get("vote");
            const reviewer = planFlags.get("reviewer");
            if (!teamId || !planId || !vote || !reviewer) failJson("--team-id, --plan-id, --reviewer, and --vote are required");
            ensureDaemon();
            const res = await sendCommand({
              cmd: "team.plan.review",
              teamId,
              planId,
              reviewer,
              vote,
              feedback: planFlags.get("feedback"),
            });
            printJson(res);
            return;
          }

          case "get": {
            const teamId = planFlags.get("team-id");
            const planId = planFlags.get("plan-id");
            if (!teamId || !planId) failJson("--team-id and --plan-id are required");
            ensureDaemon();
            const res = await sendCommand({ cmd: "team.plan.get", teamId, planId });
            printJson(res);
            return;
          }

          case "latest": {
            const teamId = planFlags.get("team-id");
            if (!teamId) failJson("--team-id is required");
            ensureDaemon();
            const res = await sendCommand({ cmd: "team.plan.latest", teamId });
            printJson(res);
            return;
          }

          case "delete": {
            const teamId = planFlags.get("team-id");
            const planId = planFlags.get("plan-id");
            if (!teamId || !planId) failJson("--team-id and --plan-id are required");
            ensureDaemon();
            const res = await sendCommand({ cmd: "team.plan.delete", teamId, planId });
            printJson(res);
            return;
          }

          default:
            failJson(`Unknown team plan subcommand: ${planSub}`);
        }
        return;
      }

      default:
        failJson(`Unknown team subcommand: ${sub}`);
    }
  }

  failJson(`Unknown command: ${command}`);
}

main().then(() => {
  // Force exit to prevent dangling handles (IPC socket timers, etc.)
  // from keeping the process alive after the command completes.
  process.exit(0);
}).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // Emit machine-readable error JSON to stdout so app-side parsers can always consume it.
  printJson({ ok: false, error: message });
  process.exit(1);
});
