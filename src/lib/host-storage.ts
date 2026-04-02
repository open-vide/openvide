import type { Host as StoreHost } from '../state/types';
import type { WebHost } from '../types';
import { HOSTS_STORAGE_KEY } from './constants';
import { decryptJsonDetailed, encryptJsonDetailed } from './secure-crypto';
import { storageSetRaw, storageRemove } from 'even-toolkit/storage';

type HostLike = WebHost | StoreHost;
type HostSecrets = {
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  authSessionId?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
};

const HOSTS_TOKENS_STORAGE_KEY = `${HOSTS_STORAGE_KEY}_tokens`;

function normalizeHostUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function loadHostsSnapshot(): HostLike[] {
  try {
    const raw = localStorage.getItem(HOSTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<HostLike>>;
    return parsed
      .filter((host): host is Partial<HostLike> & Pick<HostLike, 'id' | 'name' | 'url'> => (
        typeof host?.id === 'string' &&
        typeof host?.name === 'string' &&
        typeof host?.url === 'string'
      ))
      .map((host) => ({
        id: host.id,
        name: host.name,
        url: normalizeHostUrl(host.url),
        ...(typeof host.token === 'string' && host.token ? { token: host.token } : {}),
      }));
  } catch {
    return [];
  }
}

async function loadTokenMap(): Promise<{ tokens: Record<string, HostSecrets>; available: boolean }> {
  try {
    const raw = localStorage.getItem(HOSTS_TOKENS_STORAGE_KEY);
    if (!raw) {
      return { tokens: {}, available: true };
    }
    const decrypted = await decryptJsonDetailed<Record<string, string | HostSecrets>>(raw, {});
    const normalized = Object.fromEntries(
      Object.entries(decrypted.value).map(([hostId, value]) => [
        hostId,
        typeof value === 'string' ? { token: value } satisfies HostSecrets : value ?? {},
      ]),
    );
    return {
      tokens: normalized,
      available: decrypted.available,
    };
  } catch {
    return { tokens: {}, available: true };
  }
}

export async function loadHosts(): Promise<HostLike[]> {
  const snapshot = loadHostsSnapshot();
  const tokenState = await loadTokenMap();
  const merged = snapshot.map((host) => ({
    ...host,
    token: tokenState.tokens[host.id]?.token ?? host.token,
    accessToken: tokenState.tokens[host.id]?.accessToken,
    refreshToken: tokenState.tokens[host.id]?.refreshToken,
    authSessionId: tokenState.tokens[host.id]?.authSessionId,
    accessTokenExpiresAt: tokenState.tokens[host.id]?.accessTokenExpiresAt,
    refreshTokenExpiresAt: tokenState.tokens[host.id]?.refreshTokenExpiresAt,
  }));

  const hasLegacyPlaintext = snapshot.some((host) => typeof host.token === 'string' && host.token.length > 0);
  if (hasLegacyPlaintext && tokenState.available) {
    await persistHosts(merged);
  }

  return merged;
}

export async function persistHosts(hosts: HostLike[]): Promise<void> {
  const safeHosts = hosts.map(({ token, ...host }) => ({
    ...host,
    accessToken: undefined,
    refreshToken: undefined,
    authSessionId: undefined,
    accessTokenExpiresAt: undefined,
    refreshTokenExpiresAt: undefined,
    url: normalizeHostUrl(host.url),
  }));
  const tokens = Object.fromEntries(
    hosts
      .map((host) => {
        const secret: HostSecrets = {};
        if (typeof host.token === 'string' && host.token.trim().length > 0) secret.token = host.token.trim();
        if (typeof host.accessToken === 'string' && host.accessToken.trim().length > 0) secret.accessToken = host.accessToken.trim();
        if (typeof host.refreshToken === 'string' && host.refreshToken.trim().length > 0) secret.refreshToken = host.refreshToken.trim();
        if (typeof host.authSessionId === 'string' && host.authSessionId.trim().length > 0) secret.authSessionId = host.authSessionId.trim();
        if (typeof host.accessTokenExpiresAt === 'string' && host.accessTokenExpiresAt.trim().length > 0) secret.accessTokenExpiresAt = host.accessTokenExpiresAt.trim();
        if (typeof host.refreshTokenExpiresAt === 'string' && host.refreshTokenExpiresAt.trim().length > 0) secret.refreshTokenExpiresAt = host.refreshTokenExpiresAt.trim();
        return [host.id, secret] as const;
      })
      .filter(([, secret]) => Object.keys(secret).length > 0),
  );

  storageSetRaw(HOSTS_STORAGE_KEY, JSON.stringify(safeHosts));
  if (Object.keys(tokens).length === 0) {
    storageRemove(HOSTS_TOKENS_STORAGE_KEY);
    return;
  }

  const encrypted = await encryptJsonDetailed(tokens);
  if (!encrypted.available) {
    return;
  }

  storageSetRaw(HOSTS_TOKENS_STORAGE_KEY, encrypted.value);
}
