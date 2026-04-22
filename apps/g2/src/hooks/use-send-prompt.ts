import { useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/domain/daemon-client';
import { useBridge } from '../contexts/bridge';
import type { PermissionDecision, WebSession } from '../types';

export function useSendPrompt(sessions?: WebSession[]) {
  const { ensureBridgeForSession } = useBridge();

  return useMutation({
    mutationFn: async ({ sessionId, prompt, mode, model }: { sessionId: string; prompt: string; mode?: string; model?: string }) => {
      if (sessions) ensureBridgeForSession(sessionId, sessions);
      const params: Record<string, unknown> = { id: sessionId, prompt };
      if (mode) params.mode = mode;
      if (model) params.model = model;
      const res = await rpc('session.send', params);
      if (!res.ok) throw new Error(res.error ?? 'Failed to send prompt');
      return true;
    },
  });
}

export function useCancelSession(sessions?: WebSession[]) {
  const { ensureBridgeForSession } = useBridge();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      if (sessions) ensureBridgeForSession(sessionId, sessions);
      const res = await rpc('session.cancel', { id: sessionId });
      if (!res.ok) throw new Error(res.error ?? 'Failed to cancel');
      return true;
    },
  });
}

export function useRespondToPermission(sessions?: WebSession[]) {
  const { ensureBridgeForSession } = useBridge();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      requestId,
      decision,
    }: {
      sessionId: string;
      requestId: string;
      decision: PermissionDecision;
    }) => {
      if (sessions) ensureBridgeForSession(sessionId, sessions);
      const res = await rpc('session.permission.respond', { id: sessionId, requestId, decision });
      if (!res.ok) throw new Error(res.error ?? 'Failed to respond to permission request');
      return true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['workspace-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useDismissSession() {
  const { ensureBridgeForSession } = useBridge();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionId, sessions }: { sessionId: string; sessions?: WebSession[] }) => {
      if (sessions) ensureBridgeForSession(sessionId, sessions);
      const res = await rpc('session.remove', { id: sessionId });
      if (!res.ok) throw new Error(res.error ?? 'Failed to dismiss');
      return true;
    },
    onSuccess: () => {
      // Force the sessions list to refetch so the removed row disappears.
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['workspace-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useWorkspaceSessions() {
  return useMutation({
    mutationFn: async (cwd: string) => {
      const res = await rpc('session.list_workspace', { cwd });
      if (res.ok && Array.isArray(res.sessions)) {
        return (res.sessions as any[]).map((s: any) => ({
          id: s.id ?? s.daemonSessionId ?? s.resumeId,
          tool: s.tool,
          status: s.status ?? 'idle',
          workingDirectory: s.workingDirectory ?? cwd,
          model: s.model,
          lastPrompt: s.lastTurn?.prompt ?? s.summary,
          lastError: s.lastTurn?.error,
          updatedAt: s.updatedAt ?? s.createdAt ?? new Date().toISOString(),
          outputLines: s.outputLines ?? 0,
          origin: s.origin ?? ('native' as const),
          resumeId: s.resumeId,
          title: s.title,
          summary: s.summary,
          messageCount: s.messageCount,
          pendingPermission: s.pendingPermission,
        }));
      }
      return [];
    },
  });
}
