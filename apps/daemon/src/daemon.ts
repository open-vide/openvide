import * as fs from "node:fs";
import * as path from "node:path";
import * as child_process from "node:child_process";
import { daemonDir, log, logError } from "./utils.js";
import { startServer, cleanupSocket } from "./ipc.js";
import * as sm from "./sessionManager.js";

const PID_FILE = "daemon.pid";
const LOG_FILE = "daemon.log";
const MAIN_LOCK_FILE = "daemon.lock";
const START_LOCK_FILE = "daemon.start.lock";
const HEARTBEAT_INTERVAL = 30_000; // 30s
const STALE_THRESHOLD = 60_000; // 60s
const START_LOCK_STALE_THRESHOLD = 15_000; // 15s

function pidPath(): string {
  return path.join(daemonDir(), PID_FILE);
}

function logPath(): string {
  return path.join(daemonDir(), LOG_FILE);
}

function mainLockPath(): string {
  return path.join(daemonDir(), MAIN_LOCK_FILE);
}

function startLockPath(): string {
  return path.join(daemonDir(), START_LOCK_FILE);
}

function readPidFromFile(filePath: string): number | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    const firstLine = raw.split("\n")[0]?.trim();
    if (!firstLine) return undefined;
    const pid = parseInt(firstLine, 10);
    if (!Number.isFinite(pid) || pid <= 0) return undefined;
    return pid;
  } catch {
    return undefined;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryRemoveStaleLock(lockFile: string, staleThresholdMs: number): void {
  try {
    const ownerPid = readPidFromFile(lockFile);
    if (ownerPid && isPidAlive(ownerPid)) {
      return;
    }
    if (ownerPid && !isPidAlive(ownerPid)) {
      fs.unlinkSync(lockFile);
      return;
    }
    const stat = fs.statSync(lockFile);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < staleThresholdMs) {
      return;
    }
    fs.unlinkSync(lockFile);
  } catch {
    // no-op
  }
}

function acquireLock(lockFile: string, staleThresholdMs: number): number | undefined {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf-8");
      return fd;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") {
        logError(`Failed to acquire lock ${lockFile}:`, e.message);
        return undefined;
      }
      tryRemoveStaleLock(lockFile, staleThresholdMs);
    }
  }
  return undefined;
}

function releaseLock(lockFd: number | undefined, lockFile: string): void {
  if (lockFd == null) return;
  try {
    fs.closeSync(lockFd);
  } catch {
    // no-op
  }
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // no-op
  }
}

// ── Daemon health check ──

export function isDaemonRunning(): boolean {
  const pidFile = pidPath();
  try {
    const raw = fs.readFileSync(pidFile, "utf-8").trim();
    const pid = parseInt(raw, 10);
    if (isNaN(pid)) return false;

    // Check if process is alive
    process.kill(pid, 0);

    // Check heartbeat freshness
    const stat = fs.statSync(pidFile);
    const age = Date.now() - stat.mtimeMs;
    if (age > STALE_THRESHOLD) {
      log(`Stale PID file (${Math.round(age / 1000)}s old), cleaning up`);
      cleanupStale();
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function cleanupStale(): void {
  try { fs.unlinkSync(pidPath()); } catch { /* ignore */ }
  cleanupSocket();
  tryRemoveStaleLock(mainLockPath(), STALE_THRESHOLD);
  tryRemoveStaleLock(startLockPath(), START_LOCK_STALE_THRESHOLD);
}

// ── Auto-start ──

export function ensureDaemon(): void {
  // Ensure daemon directory exists before any lock/PID file operations
  fs.mkdirSync(daemonDir(), { recursive: true });

  if (isDaemonRunning()) {
    tryRemoveStaleLock(startLockPath(), START_LOCK_STALE_THRESHOLD);
    return;
  }

  const lockFile = startLockPath();
  let startupLockFd = acquireLock(lockFile, START_LOCK_STALE_THRESHOLD);

  // Another CLI process is already starting the daemon. Wait for it to finish.
  if (startupLockFd == null) {
    const waitDeadline = Date.now() + 3500;
    while (Date.now() < waitDeadline) {
      if (isDaemonRunning()) return;
      const waitUntil = Date.now() + 100;
      while (Date.now() < waitUntil) { /* spin */ }
    }
    startupLockFd = acquireLock(lockFile, START_LOCK_STALE_THRESHOLD);
    if (startupLockFd == null) {
      if (!isDaemonRunning()) {
        logError("Unable to acquire daemon startup lock.");
      }
      return;
    }
  }

  try {
    if (isDaemonRunning()) return;

    log("Daemon not running, auto-starting...");
    cleanupStale();
    spawnDaemon();

    // Wait briefly for daemon to be ready
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (isDaemonRunning()) return;
      // Busy-wait in small increments (synchronous for CLI simplicity)
      const waitUntil = Date.now() + 100;
      while (Date.now() < waitUntil) { /* spin */ }
    }
    logError("Daemon auto-start did not report healthy within 3s");
  } finally {
    releaseLock(startupLockFd, lockFile);
  }
}

function spawnDaemon(): void {
  const baseDir = daemonDir();
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(path.join(baseDir, "sessions"), { recursive: true });

  const logFd = fs.openSync(logPath(), "a");

  // Self-daemonize: re-spawn this script with --daemon-main flag
  const modulePath = new URL(import.meta.url).pathname;
  const child = child_process.spawn(
    process.execPath,
    [modulePath, "--daemon-main"],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    },
  );

  child.unref();
  fs.closeSync(logFd);
}

// ── Daemon main loop (runs in background process) ──

export function runDaemonMain(): void {
  const baseDir = daemonDir();
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(path.join(baseDir, "sessions"), { recursive: true });
  const lockFile = mainLockPath();
  const mainLockFd = acquireLock(lockFile, STALE_THRESHOLD);
  if (mainLockFd == null) {
    log("Another daemon instance already owns the lock, exiting.");
    process.exit(0);
  }

  // Write PID
  fs.writeFileSync(pidPath(), String(process.pid) + "\n");

  log(`Daemon started (PID ${process.pid})`);

  // Initialize session manager (loads state, marks interrupted)
  sm.init();

  // Start IPC server
  const server = startServer();

  // Heartbeat: touch PID file
  const heartbeat = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(pidPath(), now, now);
    } catch {
      // ignore
    }
  }, HEARTBEAT_INTERVAL);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log(`Received ${signal}, shutting down...`);
    clearInterval(heartbeat);

    server.close();
    await sm.shutdownAll();

    // Cleanup
    try { fs.unlinkSync(pidPath()); } catch { /* ignore */ }
    cleanupSocket();
    releaseLock(mainLockFd, lockFile);

    log("Daemon stopped");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// ── Stop daemon from CLI ──

export function stopDaemon(): boolean {
  const pidFile = pidPath();
  try {
    const raw = fs.readFileSync(pidFile, "utf-8").trim();
    const pid = parseInt(raw, 10);
    if (isNaN(pid)) return false;

    process.kill(pid, "SIGTERM");
    log(`Sent SIGTERM to daemon (PID ${pid})`);

    // Wait for exit
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
        // Still alive, wait
        const waitUntil = Date.now() + 100;
        while (Date.now() < waitUntil) { /* spin */ }
      } catch {
        // Process gone
        return true;
      }
    }

    // Force kill
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already dead
    }
    cleanupStale();
    return true;
  } catch {
    cleanupStale();
    return false;
  }
}

// If this module is executed directly with --daemon-main, start the daemon
if (process.argv.includes("--daemon-main")) {
  runDaemonMain();
}
