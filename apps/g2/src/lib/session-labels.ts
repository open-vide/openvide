/**
 * Client-side session labels stored via SDK bridge.
 * Allows users to name sessions for easy identification.
 */

import { storageSetRaw, storageGetRaw } from './bridge-storage';

const STORAGE_KEY = 'openvide_session_labels';

/** In-memory cache — loaded async, used for sync render paths */
let labelsCache: Record<string, string> = {};

async function loadLabels(): Promise<Record<string, string>> {
  try {
    const raw = await storageGetRaw(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    labelsCache = parsed;
    return parsed;
  } catch { return {}; }
}

function saveLabels(labels: Record<string, string>): void {
  labelsCache = labels;
  storageSetRaw(STORAGE_KEY, JSON.stringify(labels));
}

/** Initialize labels cache — call on app startup */
export async function initLabels(): Promise<void> {
  await loadLabels();
}

export function getSessionLabel(sessionId: string): string | undefined {
  return labelsCache[sessionId];
}

export async function setSessionLabel(sessionId: string, label: string): Promise<void> {
  const labels = await loadLabels();
  if (label.trim()) {
    labels[sessionId] = label.trim();
  } else {
    delete labels[sessionId];
  }
  saveLabels(labels);
}

export async function removeSessionLabel(sessionId: string): Promise<void> {
  const labels = await loadLabels();
  delete labels[sessionId];
  saveLabels(labels);
}

/**
 * Get the display title for a session:
 * 1. Custom label (if set by user)
 * 2. Last prompt (truncated)
 * 3. Native title
 * 4. Tool name as fallback
 */
export function getSessionDisplayTitle(
  sessionId: string,
  lastPrompt?: string,
  nativeTitle?: string,
  toolName?: string,
): string {
  const customLabel = getSessionLabel(sessionId);
  if (customLabel) return customLabel;
  if (lastPrompt) return lastPrompt.slice(0, 80);
  if (nativeTitle) return nativeTitle;
  return toolName ?? 'Session';
}
