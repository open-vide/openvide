import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBridge } from '../contexts/bridge';
import { rpcForHost } from '../lib/bridge-hosts';
import { useSettings } from './use-settings';

export function useCreateSession() {
  const queryClient = useQueryClient();
  const { ensureBridgeForCommand, hosts, activeHostId } = useBridge();
  const { data: settings } = useSettings();

  return useMutation({
    mutationFn: async ({
      tool,
      cwd,
      model,
      hostId,
      conversationId,
    }: {
      tool: string;
      cwd: string;
      model?: string;
      hostId?: string;
      conversationId?: string;
    }) => {
      ensureBridgeForCommand();
      const params: Record<string, unknown> = { tool, cwd, autoAccept: true };
      if (model) params.model = model;
      if (conversationId) params.conversationId = conversationId;
      if (tool === 'codex' && settings?.codexPermissionMode === 'ask') {
        params.permissionMode = 'ask';
      }
      const res = await rpcForHost(hosts, hostId ?? activeHostId, 'session.create', params);
      if (res.ok && res.session) {
        return (res.session as any).id as string;
      }
      throw new Error(res.error ?? 'Failed to create session');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
