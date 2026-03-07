import * as https from "node:https";
import { log, logError } from "./utils.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_RE = /^ExponentPushToken\[.+\]$/;

interface PushPayload {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  priority?: "default" | "normal" | "high";
  categoryId?: string;
}

/**
 * Fire-and-forget push notification via Expo's push API.
 * Uses node:https directly (zero dependencies). Validates token format
 * before sending. Logs result but never throws.
 */
export function sendPushNotification(
  token: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): void {
  if (!EXPO_TOKEN_RE.test(token)) {
    logError(`Push: invalid token format: ${token.slice(0, 30)}...`);
    return;
  }

  const payload: PushPayload = {
    to: token,
    title,
    body,
    sound: "default",
    priority: "high",
    categoryId: "AI_SESSION",
  };
  if (data) {
    payload.data = data;
  }

  const jsonBody = JSON.stringify(payload);

  const req = https.request(
    EXPO_PUSH_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Content-Length": Buffer.byteLength(jsonBody),
      },
    },
    (res) => {
      let responseData = "";
      res.on("data", (chunk: Buffer) => {
        responseData += chunk.toString();
      });
      res.on("end", () => {
        log(`Push notification sent: status=${res.statusCode} response=${responseData.slice(0, 200)}`);
      });
    },
  );

  req.on("error", (err) => {
    logError(`Push notification failed: ${err.message}`);
  });

  // 10s timeout so we don't hang indefinitely
  req.setTimeout(10000, () => {
    req.destroy();
    logError("Push notification timed out");
  });

  req.write(jsonBody);
  req.end();
}
