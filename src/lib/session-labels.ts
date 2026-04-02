/**
 * Client-side session labels stored in localStorage.
 * Allows users to name sessions for easy identification.
 */

import { storageSetRaw } from 'even-toolkit/storage';

const STORAGE_KEY = 'openvide_session_labels';

function loadLabels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveLabels(labels: Record<string, string>): void {
  storageSetRaw(STORAGE_KEY, JSON.stringify(labels));
}

export function getSessionLabel(sessionId: string): string | undefined {
  return loadLabels()[sessionId];
}

export function setSessionLabel(sessionId: string, label: string): void {
  const labels = loadLabels();
  if (label.trim()) {
    labels[sessionId] = label.trim();
  } else {
    delete labels[sessionId];
  }
  saveLabels(labels);
}

export function removeSessionLabel(sessionId: string): void {
  const labels = loadLabels();
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
