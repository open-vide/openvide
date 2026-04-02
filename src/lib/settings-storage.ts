import type { WebSettings } from '../types';
import { storageSetRaw, storageRemove } from 'even-toolkit/storage';

export const SETTINGS_CACHE_KEY = 'openvide_settings_cache';
export const SETTINGS_PENDING_KEY = 'openvide_settings_pending';

export function readStoredSettingsSnapshot(
  storageKey: string,
  normalizeSettings: (settings?: Partial<WebSettings> | null) => WebSettings,
): WebSettings | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return normalizeSettings(JSON.parse(raw) as Partial<WebSettings>);
  } catch {
    return null;
  }
}

export async function readStoredSettings(
  storageKey: string,
  normalizeSettings: (settings?: Partial<WebSettings> | null) => WebSettings,
): Promise<WebSettings | null> {
  const snapshot = readStoredSettingsSnapshot(storageKey, normalizeSettings);
  if (!snapshot) return null;
  // STT API key is now stored in plaintext alongside other settings
  return snapshot;
}

export async function writeStoredSettings(
  storageKey: string,
  settings: WebSettings,
): Promise<void> {
  // Store everything in plaintext — SDK storage is sandboxed per-app
  storageSetRaw(storageKey, JSON.stringify(settings));
}

export function clearStoredSettings(storageKey: string): void {
  try {
    storageRemove(storageKey);
  } catch {
    // Ignore storage failures.
  }
}
