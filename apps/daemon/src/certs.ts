/**
 * Network detection and TLS certificate utilities for the bridge.
 *
 * Priority:
 * 1. Tailscale HTTPS cert (trusted Let's Encrypt via `tailscale cert`)
 * 2. No TLS (HTTP) — Tailscale encrypts via WireGuard, or use behind Caddy
 */

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { log } from "./utils.js";

export interface TailscaleTls {
  cert: string;
  key: string;
  hostname: string;
}

/** Detect Tailscale IP from network interfaces (100.64.0.0/10 CGNAT range). */
export function detectTailscaleIp(): string | null {
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

/** Get Tailscale MagicDNS hostname (best-effort). */
export function detectTailscaleHostname(): string | null {
  try {
    const out = execSync("tailscale status --json 2>/dev/null", { encoding: "utf-8", timeout: 3000 });
    const data = JSON.parse(out);
    const dns = data.Self?.DNSName as string | undefined;
    return dns ? dns.replace(/\.$/, "") : null;
  } catch {
    return null;
  }
}

/**
 * Try to get Tailscale HTTPS cert (Let's Encrypt issued via tailscale cert).
 * Looks for cert files in home directory (where `tailscale cert` puts them).
 * If not found, tries to generate them.
 */
export function getTailscaleTls(): TailscaleTls | null {
  const hostname = detectTailscaleHostname();
  if (!hostname) return null;

  const home = os.homedir();
  const certPath = path.join(home, `${hostname}.crt`);
  const keyPath = path.join(home, `${hostname}.key`);

  // Check if cert files exist
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const cert = fs.readFileSync(certPath, "utf-8");
      const key = fs.readFileSync(keyPath, "utf-8");
      log(`Using Tailscale HTTPS cert for ${hostname}`);
      return { cert, key, hostname };
    } catch {
      return null;
    }
  }

  // Try to generate cert
  try {
    log(`Generating Tailscale HTTPS cert for ${hostname}...`);
    execSync(`tailscale cert ${hostname}`, { cwd: home, stdio: "pipe", timeout: 15000 });
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const cert = fs.readFileSync(certPath, "utf-8");
      const key = fs.readFileSync(keyPath, "utf-8");
      log(`Tailscale HTTPS cert generated for ${hostname}`);
      return { cert, key, hostname };
    }
  } catch {
    log("Tailscale HTTPS cert not available — using HTTP");
  }

  return null;
}
