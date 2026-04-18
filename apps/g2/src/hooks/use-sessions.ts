import { useQuery } from '@tanstack/react-query';
import { rpc, rpcToHost, setBridgeUrl } from '@/domain/daemon-client';
import { useBridge, useBridgeUpdate } from '../contexts/bridge';
import { DEFAULT_POLL_INTERVAL } from '../lib/constants';
import type { WebSession } from '../types';

function mapHostSessions(raw: any[], hostId?: string): WebSession[] {
  return raw.map((s) => ({
    id: s.id,
    hostId: s.hostId ?? hostId,
    tool: s.tool,
    status: s.status,
    runKind: s.runKind,
    scheduleId: s.scheduleId,
    scheduleName: s.scheduleName,
    teamId: s.teamId,
    teamName: s.teamName,
    workingDirectory: s.workingDirectory,
    model: s.model,
    lastPrompt: s.lastTurn?.prompt ?? s.summary,
    lastError: s.lastTurn?.error,
    updatedAt: s.updatedAt ?? s.createdAt ?? new Date().toISOString(),
    outputLines: s.outputLines ?? 0,
    origin: s.origin === 'native' ? 'native' : 'daemon',
    resumeId: s.resumeId ?? s.conversationId,
    title: s.title,
    summary: s.summary,
    messageCount: s.messageCount,
  }));
}

export function useSessions(pollInterval: number = DEFAULT_POLL_INTERVAL) {
  const { hosts } = useBridge();
  const updateHostStatuses = useBridgeUpdate();

  return useQuery<WebSession[]>({
    queryKey: ['sessions', hosts.map((h) => h.id).join(',')],
    queryFn: async () => {
      if (hosts.length === 0) {
        // No hosts — single-bridge fallback
        try {
          const res = await rpc('session.catalog');
          if (res.ok && Array.isArray(res.sessions)) {
            const sessions = mapHostSessions(res.sessions as any[]);
            sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
            updateHostStatuses({});
            return sessions;
          }
          const fallback = await rpc('session.list');
          if (fallback.ok && Array.isArray(fallback.sessions)) {
            const sessions = mapHostSessions(fallback.sessions as any[]);
            sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
            updateHostStatuses({});
            return sessions;
          }
        } catch { /* not ready */ }
        return [];
      }

      // Multi-host: poll all in parallel
      const hostStatuses: Record<string, 'connected' | 'disconnected'> = {};
      const results = await Promise.allSettled(
        hosts.map(async (host) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          try {
            let res = await rpcToHost(host.url, 'session.catalog', undefined, controller.signal, {
              hostId: host.id,
              token: host.token,
              accessToken: host.accessToken,
              refreshToken: host.refreshToken,
              authSessionId: host.authSessionId,
              accessTokenExpiresAt: host.accessTokenExpiresAt,
              refreshTokenExpiresAt: host.refreshTokenExpiresAt,
            });
            if (!res.ok || !Array.isArray(res.sessions)) {
              res = await rpcToHost(host.url, 'session.list', undefined, controller.signal, {
                hostId: host.id,
                token: host.token,
                accessToken: host.accessToken,
                refreshToken: host.refreshToken,
                authSessionId: host.authSessionId,
                accessTokenExpiresAt: host.accessTokenExpiresAt,
                refreshTokenExpiresAt: host.refreshTokenExpiresAt,
              });
            }
            clearTimeout(timer);
            if (res.ok && Array.isArray(res.sessions)) {
              hostStatuses[host.id] = 'connected';
              return { hostId: host.id, sessions: mapHostSessions(res.sessions as any[], host.id) };
            }
            hostStatuses[host.id] = 'disconnected';
            return { hostId: host.id, sessions: [] as WebSession[] };
          } catch {
            clearTimeout(timer);
            hostStatuses[host.id] = 'disconnected';
            return { hostId: host.id, sessions: [] as WebSession[] };
          }
        }),
      );

      let allSessions: WebSession[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          allSessions.push(...r.value.sessions);
        }
      }
      allSessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      // Set bridge URL to first connected host
      const connectedHostId = Object.entries(hostStatuses).find(([, s]) => s === 'connected')?.[0];
      if (connectedHostId) {
        const connectedHost = hosts.find((h) => h.id === connectedHostId);
        if (connectedHost) setBridgeUrl(connectedHost.url);
      }

      updateHostStatuses(hostStatuses);
      return allSessions;
    },
    refetchInterval: pollInterval,
    staleTime: pollInterval / 2,
  });
}
