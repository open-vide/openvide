import { rpc, rpcToHost } from '@/domain/daemon-client';
import type { WebHost } from '@/types';

export function resolvePreferredHostId(
  hosts: WebHost[],
  activeHostId?: string | null,
  requestedHostId?: string | null,
): string {
  if (requestedHostId && hosts.some((host) => host.id === requestedHostId)) return requestedHostId;
  if (activeHostId && hosts.some((host) => host.id === activeHostId)) return activeHostId;
  return hosts[0]?.id ?? '';
}

export function getHostOptions(hosts: WebHost[]) {
  return hosts.map((host) => ({
    value: host.id,
    label: host.name,
  }));
}

export function getHostById(hosts: WebHost[], hostId?: string | null): WebHost | null {
  if (!hostId) return null;
  return hosts.find((host) => host.id === hostId) ?? null;
}

export function getHostRpcAuth(host: WebHost) {
  return {
    hostId: host.id,
    token: host.token,
    accessToken: host.accessToken,
    refreshToken: host.refreshToken,
    authSessionId: host.authSessionId,
    accessTokenExpiresAt: host.accessTokenExpiresAt,
    refreshTokenExpiresAt: host.refreshTokenExpiresAt,
  };
}

export async function rpcForHost(
  hosts: WebHost[],
  hostId: string | null | undefined,
  cmd: string,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const host = getHostById(hosts, hostId);
  if (!host) return rpc(cmd, params);
  return rpcToHost(host.url, cmd, params, signal, getHostRpcAuth(host));
}
