import type { WebSettings } from '../types';
import { storageSetRaw, storageRemove, storageGetRaw } from './bridge-storage';

export const SETTINGS_CACHE_KEY = 'openvide_settings_cache';
export const SETTINGS_PENDING_KEY = 'openvide_settings_pending';

/** Async snapshot from SDK storage. */
export async function readStoredSettingsSnapshot(
  storageKey: string,
  normalizeSettings: (settings?: Partial<WebSettings> | null) => WebSettings,
): Promise<WebSettings | null> {
  try {
    const raw = await storageGetRaw(storageKey);
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
  try {
    const raw = await storageGetRaw(storageKey);
    if (!raw) return null;
    return normalizeSettings(JSON.parse(raw) as Partial<WebSettings>);
  } catch {
    return null;
  }
}

export async function writeStoredSettings(
  storageKey: string,
  settings: WebSettings,
): Promise<void> {
  await storageSetRaw(storageKey, JSON.stringify(settings));
}

export async function clearStoredSettings(storageKey: string): Promise<void> {
  try {
    await storageRemove(storageKey);
  } catch {
    // Ignore storage failures.
  }
}
