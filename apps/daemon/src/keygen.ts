import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface KeygenResult {
  privateKey: string;   // PEM (PKCS#8)
  publicKey: string;    // ssh-ed25519 format
  fingerprint: string;  // SHA256:...
}

function toOpenSSHPublicKey(publicKeyDer: Buffer, comment: string): string {
  // ed25519 public key in OpenSSH format:
  // string "ssh-ed25519"
  // string <32-byte raw key>
  const keyType = Buffer.from("ssh-ed25519");
  // The DER-encoded public key from Node has a 12-byte header for ed25519
  // SubjectPublicKeyInfo: 30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes>
  const rawKey = publicKeyDer.subarray(publicKeyDer.length - 32);

  const typeLen = Buffer.alloc(4);
  typeLen.writeUInt32BE(keyType.length);
  const keyLen = Buffer.alloc(4);
  keyLen.writeUInt32BE(rawKey.length);

  const blob = Buffer.concat([typeLen, keyType, keyLen, rawKey]);
  return `ssh-ed25519 ${blob.toString("base64")} ${comment}`;
}

function computeFingerprint(publicKeyDer: Buffer): string {
  const rawKey = publicKeyDer.subarray(publicKeyDer.length - 32);
  const keyType = Buffer.from("ssh-ed25519");
  const typeLen = Buffer.alloc(4);
  typeLen.writeUInt32BE(keyType.length);
  const keyLen = Buffer.alloc(4);
  keyLen.writeUInt32BE(rawKey.length);
  const blob = Buffer.concat([typeLen, keyType, keyLen, rawKey]);

  const hash = crypto.createHash("sha256").update(blob).digest("base64");
  // Remove trailing '=' padding to match ssh-keygen output
  return `SHA256:${hash.replace(/=+$/, "")}`;
}

export function generateKeyPair(comment: string): KeygenResult {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const publicKeyDer = crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" });

  const openSSHPubKey = toOpenSSHPublicKey(publicKeyDer, comment);
  const fingerprint = computeFingerprint(publicKeyDer);

  // Append to authorized_keys
  const sshDir = path.join(os.homedir(), ".ssh");
  const authKeysPath = path.join(sshDir, "authorized_keys");

  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700, recursive: true });
  }

  // Ensure authorized_keys exists with correct permissions
  if (!fs.existsSync(authKeysPath)) {
    fs.writeFileSync(authKeysPath, "", { mode: 0o600 });
  }

  // Append public key with a newline
  const existing = fs.readFileSync(authKeysPath, "utf-8");
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(authKeysPath, `${separator}${openSSHPubKey}\n`);

  return {
    privateKey,
    publicKey: openSSHPubKey,
    fingerprint,
  };
}
