/**
 * TLS certificate and auth token generation for the bridge.
 * Self-signed ECDSA cert + 32-byte random token.
 * Stored at ~/.openvide-daemon/bridge/
 *
 * Auto-detects Tailscale IPs and includes them in certificate SANs.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

const BRIDGE_DIR = path.join(os.homedir(), '.openvide-daemon', 'bridge');
const CERT_PATH = path.join(BRIDGE_DIR, 'cert.pem');
const KEY_PATH = path.join(BRIDGE_DIR, 'key.pem');
const TOKEN_PATH = path.join(BRIDGE_DIR, 'token.txt');

export interface BridgeCerts {
  cert: string;
  key: string;
  token: string;
}

/** Generate a 32-byte hex auth token. */
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Detect Tailscale IP from network interfaces (100.64.0.0/10 CGNAT range). */
export function detectTailscaleIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const parts = addr.address.split('.').map(Number);
      if (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) {
        return addr.address;
      }
    }
  }
  return null;
}

/** Build SAN string with all local IPs, hostname, and Tailscale IP. */
function buildSubjectAltName(): string {
  const entries = new Set<string>(['DNS:localhost', 'IP:127.0.0.1']);
  const hostname = os.hostname().trim();
  if (hostname) {
    entries.add(`DNS:${hostname}`);
    const shortHost = hostname.split('.')[0];
    if (shortHost) entries.add(`DNS:${shortHost}`);
  }

  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal || addr.family !== 'IPv4') continue;
      entries.add(`IP:${addr.address}`);
    }
  }

  return Array.from(entries).join(',');
}

/** Check if the existing cert includes a specific IP in its SANs. */
function certIncludesIp(certPem: string, ip: string): boolean {
  try {
    const result = execSync(`echo "${certPem}" | openssl x509 -noout -text 2>/dev/null`, { encoding: 'utf-8' });
    return result.includes(`IP Address:${ip}`);
  } catch {
    return false;
  }
}

/**
 * Generate self-signed TLS cert + key using openssl CLI.
 * Includes all local IPs + Tailscale IP in SANs.
 */
function generateCert(): { cert: string; key: string } {
  const tmpKey = path.join(BRIDGE_DIR, 'key.tmp.pem');
  const tmpCert = path.join(BRIDGE_DIR, 'cert.tmp.pem');

  try {
    execSync(
      `openssl ecparam -name prime256v1 -genkey -noout -out "${tmpKey}"`,
      { stdio: 'pipe' },
    );

    execSync(
      `openssl req -new -x509 -key "${tmpKey}" -out "${tmpCert}" -days 3650 -subj "/CN=openvide-bridge" -addext "subjectAltName=${buildSubjectAltName()}"`,
      { stdio: 'pipe' },
    );

    const cert = fs.readFileSync(tmpCert, 'utf-8');
    const key = fs.readFileSync(tmpKey, 'utf-8');

    fs.renameSync(tmpKey, KEY_PATH);
    fs.renameSync(tmpCert, CERT_PATH);
    fs.chmodSync(KEY_PATH, 0o600);
    fs.chmodSync(CERT_PATH, 0o644);

    return { cert, key };
  } catch (err) {
    try { fs.unlinkSync(tmpKey); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpCert); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Ensure TLS certs and auth token exist. Generate on first run.
 * Regenerates cert if Tailscale IP detected but not in existing SANs.
 */
export function ensureCerts(): BridgeCerts {
  fs.mkdirSync(BRIDGE_DIR, { recursive: true });

  let token: string;
  if (fs.existsSync(TOKEN_PATH)) {
    token = fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
  } else {
    token = generateToken();
    fs.writeFileSync(TOKEN_PATH, token + '\n', { mode: 0o600 });
    console.log('[certs] Generated new auth token');
  }

  let cert: string;
  let key: string;
  const hasCert = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);

  if (hasCert) {
    cert = fs.readFileSync(CERT_PATH, 'utf-8');
    key = fs.readFileSync(KEY_PATH, 'utf-8');

    const tsIp = detectTailscaleIp();
    if (tsIp && !certIncludesIp(cert, tsIp)) {
      console.log(`[certs] Tailscale IP ${tsIp} not in certificate — regenerating...`);
      const generated = generateCert();
      cert = generated.cert;
      key = generated.key;
      console.log('[certs] TLS certificate regenerated with Tailscale IP');
    }
  } else {
    console.log('[certs] Generating self-signed TLS certificate...');
    const generated = generateCert();
    cert = generated.cert;
    key = generated.key;
    console.log('[certs] TLS certificate generated');
  }

  return { cert, key, token };
}

/**
 * Get the connection URL for this bridge instance.
 */
export function getConnectionUrl(host: string, port: number, token: string): string {
  return `openvide://${host}:${port}?token=${token}`;
}

/**
 * Print connection info to terminal.
 */
export function printConnectionInfo(host: string, port: number, token: string): void {
  const tsIp = detectTailscaleIp();

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       OpenVide Bridge Connection         ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║ Local:     https://${host}:${port}`);
  if (tsIp) {
    console.log(`║ Tailscale: https://${tsIp}:${port}`);
  } else {
    console.log('║ Tailscale: not detected');
  }
  console.log(`║ Token:     ${token.slice(0, 8)}...${token.slice(-8)}`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}
