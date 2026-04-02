import type { WebSettings } from '../types';
import { decryptValueDetailed, encryptValueDetailed } from './secure-crypto';
import { storageSetRaw, storageRemove } from 'even-toolkit/storage';

export const SETTINGS_CACHE_KEY = 'openvide_settings_cache';
export const SETTINGS_PENDING_KEY = 'openvide_settings_pending';

function secureStorageKey(baseKey: string): string {
  return `${baseKey}_secret`;
}

function stripSecrets(settings: WebSettings): Omit<WebSettings, 'sttApiKey'> & { sttApiKey?: string } {
  const { sttApiKey, ...rest } = settings;
  return rest;
}

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

  try {
    const encrypted = localStorage.getItem(secureStorageKey(storageKey));
    if (!encrypted) return snapshot;
    const decrypted = await decryptValueDetailed(encrypted);
    if (!decrypted.available) return snapshot;
    const sttApiKey = decrypted.value;
    return normalizeSettings({ ...snapshot, sttApiKey });
  } catch {
    return snapshot;
  }
}

export async function writeStoredSettings(
  storageKey: string,
  settings: WebSettings,
): Promise<void> {
  storageSetRaw(storageKey, JSON.stringify(stripSecrets(settings)));

  if (!settings.sttApiKey) {
    storageRemove(secureStorageKey(storageKey));
    return;
  }

  const encrypted = await encryptValueDetailed(settings.sttApiKey);
  if (!encrypted.available) {
    return;
  }

  storageSetRaw(secureStorageKey(storageKey), encrypted.value);
}

export function clearStoredSettings(storageKey: string): void {
  try {
    storageRemove(storageKey);
    storageRemove(secureStorageKey(storageKey));
  } catch {
    // Ignore storage failures.
  }
}
