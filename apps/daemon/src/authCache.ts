/**
 * Auth credential caching for macOS Keychain workaround.
 *
 * Problem: When the daemon is started from an SSH session (key-based auth),
 * macOS does not unlock the login Keychain for that security session.
 * Claude Code stores its OAuth tokens in the Keychain, so daemon-spawned
 * Claude processes fail with "Not logged in".
 *
 * Solution: Cache the credential to a file whenever we CAN read the Keychain
 * (e.g., daemon started from a local GUI terminal). When the Keychain is
 * inaccessible (SSH session), fall back to the cached credential and pass it
 * as ANTHROPIC_API_KEY to the spawned Claude process.
 */
import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { daemonDir, log } from "./utils.js";

const CACHE_FILE = "claude-auth.json";

interface CachedAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  cachedAt: number;
}

function cachePath(): string {
  return path.join(daemonDir(), CACHE_FILE);
}

/**
 * Try to read Claude Code credentials from the macOS Keychain and cache them.
 * This only succeeds when run from a session with Keychain access (local GUI terminal).
 * Returns the access token if successful, undefined otherwise.
 */
export function tryCacheClaudeAuth(): string | undefined {
  try {
    const user = process.env.USER || process.env.LOGNAME || "";
    if (!user) return undefined;

    const raw = child_process.execSync(
      `security find-generic-password -s "Claude Code-credentials" -a "${user}" -w`,
      { timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    ).toString();

    const creds = JSON.parse(raw);
    const oauth = creds?.claudeAiOauth;
    if (!oauth?.accessToken) return undefined;

    // Cache to file (atomic write via rename)
    const cached: CachedAuth = {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt || 0,
      cachedAt: Date.now(),
    };

    const filePath = cachePath();
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(cached), { mode: 0o600 });
    fs.renameSync(tmpPath, filePath);

    log("Cached Claude auth token from Keychain");
    return oauth.accessToken;
  } catch {
    return undefined;
  }
}

/**
 * Read the cached Claude auth token from disk.
 * Returns the access token if available and not expired.
 */
export function readCachedClaudeAuth(): string | undefined {
  try {
    const raw = fs.readFileSync(cachePath(), "utf-8");
    const cached: CachedAuth = JSON.parse(raw);

    if (!cached.accessToken) return undefined;

    // Check expiry (with 5 minute buffer)
    if (cached.expiresAt && cached.expiresAt < Date.now() + 5 * 60 * 1000) {
      log("Cached Claude auth token is expired");
      return undefined;
    }

    return cached.accessToken;
  } catch {
    return undefined;
  }
}

/**
 * Resolve Claude auth token: try Keychain first, then cache.
 */
export function resolveClaudeAuth(): string | undefined {
  return tryCacheClaudeAuth() || readCachedClaudeAuth();
}
