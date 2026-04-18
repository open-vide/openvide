import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/domain/daemon-client';
import { useBridge } from '../contexts/bridge';
import type { WebBridgeConfig } from '../types';

export const defaultBridgeConfig: WebBridgeConfig = {
  enabled: false,
  port: 7842,
  tls: true,
  defaultCwd: '',
  evenAiTool: 'claude',
  evenAiMode: 'last',
  evenAiPinnedSessionId: '',
  currentEvenAiSessionId: '',
};

function normalizeBridgeConfig(config?: Partial<WebBridgeConfig> | null): WebBridgeConfig {
  return {
    enabled: config?.enabled === true,
    port: typeof config?.port === 'number' ? config.port : 7842,
    tls: config?.tls !== false,
    defaultCwd: config?.defaultCwd ?? '',
    evenAiTool:
      config?.evenAiTool === 'codex' || config?.evenAiTool === 'gemini'
        ? config.evenAiTool
        : 'claude',
    evenAiMode:
      config?.evenAiMode === 'new' || config?.evenAiMode === 'pinned'
        ? config.evenAiMode
        : 'last',
    evenAiPinnedSessionId: config?.evenAiPinnedSessionId ?? '',
    currentEvenAiSessionId: config?.currentEvenAiSessionId ?? '',
  };
}

export function useBridgeConfig() {
  const { activeHostId, ensureBridgeForCommand } = useBridge();

  return useQuery<WebBridgeConfig>({
    queryKey: ['bridge-config', activeHostId ?? 'default'],
    queryFn: async () => {
      ensureBridgeForCommand();
      const res = await rpc('bridge.config');
      if (!res.ok) {
        throw new Error(typeof res.error === 'string' ? res.error : 'Unable to load bridge config');
      }
      return normalizeBridgeConfig(res.bridgeConfig as Partial<WebBridgeConfig> | undefined);
    },
    retry: false,
    staleTime: 30000,
  });
}

export function useUpdateBridgeConfig() {
  const queryClient = useQueryClient();
  const { activeHostId, ensureBridgeForCommand } = useBridge();
  const queryKey = ['bridge-config', activeHostId ?? 'default'];

  return useMutation({
    mutationFn: async (updates: Partial<WebBridgeConfig>) => {
      ensureBridgeForCommand();
      const res = await rpc('bridge.config', updates);
      if (!res.ok) {
        throw new Error(typeof res.error === 'string' ? res.error : 'Unable to update bridge config');
      }
      return normalizeBridgeConfig(res.bridgeConfig as Partial<WebBridgeConfig> | undefined);
    },
    onSuccess: (config) => {
      queryClient.setQueryData(queryKey, config);
    },
  });
}
