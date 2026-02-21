export interface QrConnectionPayload {
  v: 1;
  privateKey: string;
  host?: string;
  port?: number;
  username?: string;
}

// ed25519 PKCS#8 DER prefix (16 bytes, fixed for all ed25519 keys)
const ED25519_PKCS8_PREFIX = "MC4CAQAwBQYDK2VwBCIEIA==";
// The prefix base64 decodes to the 16-byte header; we slice off the
// padding and concatenate with the 32-byte seed to form the full key.

function seedToPem(seedBase64: string): string {
  // Reconstruct PKCS#8 DER: fixed 16-byte prefix + 32-byte seed
  // prefix hex: 302e020100300506032b657004220420
  const prefix = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);

  // Decode seed from base64 manually using atob
  const seedChars = atob(seedBase64);
  const der = new Uint8Array(prefix.length + seedChars.length);
  der.set(prefix);
  for (let i = 0; i < seedChars.length; i++) {
    der[prefix.length + i] = seedChars.charCodeAt(i);
  }

  // Base64-encode the full DER
  let binary = "";
  for (let i = 0; i < der.length; i++) {
    binary += String.fromCharCode(der[i]!);
  }
  const b64 = btoa(binary);

  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

export function decodeQrPayload(raw: string): QrConnectionPayload | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj.v !== 1) return null;

    // Compact format: { v, h, p, u, k } where k is base64 seed
    const host = (obj.h ?? obj.host) as string | undefined;
    const port = (obj.p ?? obj.port) as number | undefined;
    const username = (obj.u ?? obj.username) as string | undefined;
    const key = (obj.k ?? obj.privateKey) as string | undefined;

    if (typeof key !== "string" || key.length === 0) return null;

    // Determine if key is a raw seed or full PEM
    const privateKey = key.includes("PRIVATE KEY") ? key : seedToPem(key);

    // Host, port, username are optional auto-fill fields
    const validHost = typeof host === "string" && host.length > 0 ? host : undefined;
    const validPort = typeof port === "number" && port >= 1 && port <= 65535 ? port : undefined;
    const validUsername = typeof username === "string" && username.length > 0 ? username : undefined;

    return { v: 1, privateKey, host: validHost, port: validPort, username: validUsername };
  } catch {
    return null;
  }
}
