export interface QrConnectionPayload {
  v: 1;
  host: string;
  port: number;
  username: string;
  privateKey: string;
}

export function decodeQrPayload(raw: string): QrConnectionPayload | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj.v !== 1) return null;
    if (typeof obj.host !== "string" || obj.host.length === 0) return null;
    if (typeof obj.port !== "number" || obj.port < 1 || obj.port > 65535) return null;
    if (typeof obj.username !== "string" || obj.username.length === 0) return null;
    if (typeof obj.privateKey !== "string" || !obj.privateKey.includes("PRIVATE KEY")) return null;

    return {
      v: 1,
      host: obj.host,
      port: obj.port,
      username: obj.username,
      privateKey: obj.privateKey,
    };
  } catch {
    return null;
  }
}
