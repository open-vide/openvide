import type { Host as StoreHost } from '../state/types';
import type { WebHost } from '../types';
import { HOSTS_STORAGE_KEY } from './constants';
import { storageSetRaw, storageRemove, storageGetRaw } from './bridge-storage';

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

function parseHostsList(raw: string | null): HostLike[] {
  if (!raw) return [];
  try {
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

/** Async snapshot from SDK storage. */
export async function loadHostsSnapshot(): Promise<HostLike[]> {
  try {
    const raw = await storageGetRaw(HOSTS_STORAGE_KEY);
    return parseHostsList(raw || null);
  } catch {
    return [];
  }
}

function parseTokenMap(raw: string | null): { tokens: Record<string, HostSecrets>; available: boolean } {
  if (!raw) return { tokens: {}, available: true };
  try {
    const parsed = JSON.parse(raw) as Record<string, string | HostSecrets>;
    const normalized = Object.fromEntries(
      Object.entries(parsed).map(([hostId, value]) => [
        hostId,
        typeof value === 'string' ? { token: value } satisfies HostSecrets : value ?? {},
      ]),
    );
    return { tokens: normalized, available: true };
  } catch {
    return { tokens: {}, available: true };
  }
}

export async function loadHosts(): Promise<HostLike[]> {
  const [hostsRaw, tokensRaw] = await Promise.all([
    storageGetRaw(HOSTS_STORAGE_KEY).catch(() => null),
    storageGetRaw(HOSTS_TOKENS_STORAGE_KEY).catch(() => null),
  ]);
  const snapshot = parseHostsList(hostsRaw);
  const tokenState = parseTokenMap(tokensRaw);
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
  if (hasLegacyPlaintext) {
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

  await storageSetRaw(HOSTS_STORAGE_KEY, JSON.stringify(safeHosts));
  if (Object.keys(tokens).length === 0) {
    await storageRemove(HOSTS_TOKENS_STORAGE_KEY);
    return;
  }

  // Store tokens as plaintext JSON — SDK storage is sandboxed per-app
  await storageSetRaw(HOSTS_TOKENS_STORAGE_KEY, JSON.stringify(tokens));
}
