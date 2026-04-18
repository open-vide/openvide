import { useQuery } from '@tanstack/react-query';
import { rpcToHost } from '@/domain/daemon-client';
import type { WebHost, HostHealthInfo } from '../types';

export function useHostHealth(host: WebHost | undefined) {
  return useQuery<HostHealthInfo>({
    queryKey: ['host-health', host?.id],
    queryFn: async () => {
      if (!host) return { ok: false };
      try {
        const res = await rpcToHost(host.url, 'health', undefined, undefined, {
          hostId: host.id,
          token: host.token,
          accessToken: host.accessToken,
          refreshToken: host.refreshToken,
          authSessionId: host.authSessionId,
          accessTokenExpiresAt: host.accessTokenExpiresAt,
          refreshTokenExpiresAt: host.refreshTokenExpiresAt,
        });
        if (res.ok) {
          return {
            ok: true,
            pid: res.pid as number | undefined,
            activeSessions: res.activeSessions as number | undefined,
            totalSessions: res.totalSessions as number | undefined,
            name: res.name as string | undefined,
            version: res.version as string | undefined,
            tls: res.tls as boolean | undefined,
            tools: res.tools as Record<string, boolean> | undefined,
          };
        }
        return { ok: false };
      } catch {
        return { ok: false };
      }
    },
    enabled: !!host,
    staleTime: 10000,
  });
}
