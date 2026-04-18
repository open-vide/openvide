import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/domain/daemon-client';
import type { WebSettings } from '../types';
import { useBridge } from '../contexts/bridge';
import { applySettingsPatch, getDefaultVoiceLanguage } from '../lib/settings';
import {
  SETTINGS_CACHE_KEY,
  SETTINGS_PENDING_KEY,
  readStoredSettings,
  readStoredSettingsSnapshot,
  writeStoredSettings,
  clearStoredSettings,
} from '../lib/settings-storage';

let settingsWriteChain: Promise<WebSettings | null> = Promise.resolve(null);

export const defaultSettings: WebSettings = {
  language: 'en',
  voiceLang: getDefaultVoiceLanguage('en'),
  showToolDetails: true,
  pollInterval: 2500,
  showHiddenFiles: false,
  sttProvider: 'soniox',
  sttApiKey: '',
  sttApiKeySoniox: '',
  sttApiKeyWhisper: '',
  sttApiKeyDeepgram: '',
};

const VALID_STT_PROVIDERS: WebSettings['sttProvider'][] = ['soniox', 'whisper-api', 'deepgram'];

function normalizeSttProvider(provider?: string | null): WebSettings['sttProvider'] {
  if (provider && VALID_STT_PROVIDERS.includes(provider as WebSettings['sttProvider'])) {
    return provider as WebSettings['sttProvider'];
  }
  return 'soniox';
}

export function normalizeSettings(settings?: Partial<WebSettings> | null): WebSettings {
  const merged = { ...defaultSettings, ...(settings ?? {}) };
  return {
    ...merged,
    sttProvider: normalizeSttProvider(settings?.sttProvider ?? merged.sttProvider),
  };
}

async function getLocalSettingsFallback(): Promise<WebSettings> {
  const pending = await readStoredSettingsSnapshot(SETTINGS_PENDING_KEY, normalizeSettings);
  if (pending) return pending;
  const cached = await readStoredSettingsSnapshot(SETTINGS_CACHE_KEY, normalizeSettings);
  if (cached) return cached;
  return defaultSettings;
}

function queueSettingsPersist(
  ensureBridgeForCommand: () => void,
  settings: WebSettings,
): Promise<WebSettings | null> {
  settingsWriteChain = settingsWriteChain
    .catch(() => null)
    .then(async () => {
      ensureBridgeForCommand();
      const res = await rpc('settings.set', { settings });
      if (!res.ok || !res.settings) {
        throw new Error(typeof res.error === 'string' ? res.error : 'Unable to persist settings');
      }
      return normalizeSettings(res.settings as Partial<WebSettings>);
    });

  return settingsWriteChain.catch(() => null);
}

export function useSettings() {
  const queryClient = useQueryClient();
  const { ensureBridgeForCommand, hosts, hostStatuses, activeHostId } = useBridge();
  const bridgeAvailable = activeHostId
    ? hostStatuses[activeHostId] === 'connected'
    : hosts.some((host) => hostStatuses[host.id] === 'connected');

  const query = useQuery<WebSettings>({
    queryKey: ['settings'],
    queryFn: async () => {
      const pending = await readStoredSettings(SETTINGS_PENDING_KEY, normalizeSettings);
      const cached = await readStoredSettings(SETTINGS_CACHE_KEY, normalizeSettings);
      const local = pending ?? cached ?? defaultSettings;
      const localOverride = pending ?? cached;
      try {
        ensureBridgeForCommand();
        const res = await rpc('settings.get');
        if (res.ok && res.settings) {
          const remote = normalizeSettings(res.settings as Partial<WebSettings>);
          const merged = localOverride
            ? normalizeSettings({ ...remote, ...localOverride })
            : remote;
          await writeStoredSettings(SETTINGS_CACHE_KEY, merged);
          return merged;
        }
      } catch { /* ignore */ }
      return local;
    },
    staleTime: 30000,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pending = await readStoredSettings(SETTINGS_PENDING_KEY, normalizeSettings);
      if (!pending || cancelled) return;
      const current = normalizeSettings(queryClient.getQueryData<WebSettings>(['settings']) ?? pending);
      const desired = normalizeSettings({ ...current, ...pending });
      const persisted = await queueSettingsPersist(ensureBridgeForCommand, desired);
      if (!cancelled && persisted) {
        await writeStoredSettings(SETTINGS_CACHE_KEY, persisted);
        clearStoredSettings(SETTINGS_PENDING_KEY);
        queryClient.setQueryData(['settings'], persisted);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridgeAvailable, ensureBridgeForCommand, queryClient]);

  return query;
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();
  const { ensureBridgeForCommand } = useBridge();

  return useMutation({
    mutationFn: async ({ key, value }: { key: keyof WebSettings; value: any }) => {
      const current = normalizeSettings(queryClient.getQueryData<WebSettings>(['settings']) ?? await getLocalSettingsFallback());
      const updated = normalizeSettings(applySettingsPatch(current, { [key]: value } as Partial<WebSettings>));
      queryClient.setQueryData(['settings'], updated);
      await writeStoredSettings(SETTINGS_CACHE_KEY, updated);
      await writeStoredSettings(SETTINGS_PENDING_KEY, updated);

      const persisted = await queueSettingsPersist(ensureBridgeForCommand, updated);
      if (persisted) {
        await writeStoredSettings(SETTINGS_CACHE_KEY, persisted);
        clearStoredSettings(SETTINGS_PENDING_KEY);
        queryClient.setQueryData(['settings'], persisted);
      }

      return persisted ?? updated;
    },
  });
}
