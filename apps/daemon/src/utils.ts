import * as crypto from "node:crypto";
import * as path from "node:path";
import * as os from "node:os";

const LOG_PREFIX = "[OV:daemon]";

export function newId(prefix: string): string {
  const rand = crypto.randomBytes(8).toString("hex");
  return `${prefix}_${rand}`;
}

export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function daemonDir(): string {
  return path.join(os.homedir(), ".openvide-daemon");
}

export function log(...args: unknown[]): void {
  const ts = new Date().toISOString();
  console.log(`${ts} ${LOG_PREFIX}`, ...args);
}

export function logError(...args: unknown[]): void {
  const ts = new Date().toISOString();
  console.error(`${ts} ${LOG_PREFIX} ERROR`, ...args);
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function nowEpoch(): number {
  return Date.now();
}
