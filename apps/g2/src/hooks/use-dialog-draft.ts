import { useCallback, useEffect, useState } from 'react';

export const PICKED_PATH_STORAGE_KEY = 'openvide_picked_path';
export interface PickedPathPayload {
  path: string;
  hostId?: string;
}

function readDraft<T>(storageKey: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function useDialogDraft<T>(storageKey: string, initialDraft: T) {
  const [draft, setDraft] = useState<T>(() => readDraft(storageKey, initialDraft));

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      // Ignore storage failures and keep the in-memory draft.
    }
  }, [storageKey, draft]);

  const clearDraft = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore storage failures.
    }
    setDraft(initialDraft);
  }, [initialDraft, storageKey]);

  return { draft, setDraft, clearDraft };
}

export function consumePickedLocation(): PickedPathPayload | null {
  try {
    const picked = sessionStorage.getItem(PICKED_PATH_STORAGE_KEY);
    if (picked) {
      sessionStorage.removeItem(PICKED_PATH_STORAGE_KEY);
      if (picked.startsWith('{')) {
        const parsed = JSON.parse(picked) as PickedPathPayload;
        if (typeof parsed.path === 'string' && parsed.path) return parsed;
      }
      return { path: picked };
    }
  } catch {
    // Ignore storage failures.
  }
  return null;
}

export function consumePickedPath(): string | null {
  return consumePickedLocation()?.path ?? null;
}
