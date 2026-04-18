/**
 * Daemon client with WebSocket transport and HTTP fallback.
 * Uses persistent WS for RPC + live output streaming.
 * Falls back to HTTP POST /api/rpc + SSE for clients without WS.
 *
 * Bridge auth model:
 * - pairing/bootstrap token: user-pasted token from `openvide-daemon bridge token`
 * - short-lived access token: used for HTTP/WS requests
 * - rotating refresh token: renews access token without re-pasting the pairing token
 */

import type { WebHost } from '@/types';

export interface RpcResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
type StatusListener = (status: ConnectionStatus) => void;

type BridgeAuthSession = Pick<WebHost, 'id' | 'token' | 'accessToken' | 'refreshToken' | 'authSessionId' | 'accessTokenExpiresAt' | 'refreshTokenExpiresAt'>;
type HostAuthInput = Omit<BridgeAuthSession, 'id'> & { hostId?: string };
type HostAuthPatch = {
  token?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  authSessionId?: string | null;
  accessTokenExpiresAt?: string | null;
  refreshTokenExpiresAt?: string | null;
};
type HostAuthListener = (hostId: string, patch: HostAuthPatch) => void;

const ACCESS_REFRESH_SKEW_MS = 60_000;

let bridgeUrl = '';
let bridgeAuth: HostAuthInput = {};
let status: ConnectionStatus = 'disconnected';
let statusListeners: StatusListener[] = [];
let hostAuthListeners: HostAuthListener[] = [];

// ── WebSocket state ──

let ws: WebSocket | null = null;
let wsReady = false;
let wsConnectPromise: Promise<void> | null = null;
let intentionallyClosingSockets = new WeakSet<WebSocket>();
let rpcIdCounter = 1;
let pendingRpcs = new Map<number, { resolve: (v: RpcResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let outputListeners = new Map<string, Set<(line: string) => void>>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(s: ConnectionStatus): void {
  if (status === s) return;
  status = s;
  for (const fn of statusListeners) fn(s);
}

function currentRequestToken(): string {
  return bridgeAuth.accessToken?.trim() || bridgeAuth.token?.trim() || '';
}

function accessNeedsRefresh(expiresAt?: string | null): boolean {
  if (!expiresAt) return true;
  const epoch = Date.parse(expiresAt);
  if (!Number.isFinite(epoch)) return true;
  return epoch <= Date.now() + ACCESS_REFRESH_SKEW_MS;
}

function mergeAuthPatch(auth: HostAuthInput, patch: HostAuthPatch): HostAuthInput {
  const next: HostAuthInput = { ...auth };
  for (const [key, value] of Object.entries(patch) as Array<[keyof HostAuthPatch, string | null | undefined]>) {
    if (value == null || value === '') {
      delete (next as Record<string, unknown>)[key];
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

function preferNewerAuth(current: HostAuthInput, incoming: HostAuthInput): HostAuthInput {
  if (!incoming.hostId || incoming.hostId !== current.hostId) {
    return { ...incoming };
  }

  const next: HostAuthInput = { ...incoming };
  const currentAccessExp = Date.parse(current.accessTokenExpiresAt ?? '');
  const incomingAccessExp = Date.parse(incoming.accessTokenExpiresAt ?? '');
  if (
    current.accessToken &&
    (!incoming.accessToken || (Number.isFinite(currentAccessExp) && (!Number.isFinite(incomingAccessExp) || currentAccessExp > incomingAccessExp)))
  ) {
    next.accessToken = current.accessToken;
    next.accessTokenExpiresAt = current.accessTokenExpiresAt;
  }

  const currentRefreshExp = Date.parse(current.refreshTokenExpiresAt ?? '');
  const incomingRefreshExp = Date.parse(incoming.refreshTokenExpiresAt ?? '');
  if (
    current.refreshToken &&
    (!incoming.refreshToken || (Number.isFinite(currentRefreshExp) && (!Number.isFinite(incomingRefreshExp) || currentRefreshExp > incomingRefreshExp)))
  ) {
    next.refreshToken = current.refreshToken;
    next.refreshTokenExpiresAt = current.refreshTokenExpiresAt;
  }

  if (current.authSessionId && !incoming.authSessionId) {
    next.authSessionId = current.authSessionId;
  }

  if (current.token && !incoming.token) {
    next.token = current.token;
  }

  return next;
}

function emitHostAuthUpdate(hostId: string | undefined, patch: HostAuthPatch): void {
  if (!hostId) return;
  for (const listener of hostAuthListeners) {
    listener(hostId, patch);
  }
}

function setActiveAuthPatch(patch: HostAuthPatch, emit = true): void {
  const previousToken = currentRequestToken();
  bridgeAuth = mergeAuthPatch(bridgeAuth, patch);
  if (emit) emitHostAuthUpdate(bridgeAuth.hostId, patch);
  const nextToken = currentRequestToken();
  if (bridgeUrl && previousToken !== nextToken) {
    disconnectWebSocket();
    if (bridgeUrl && (nextToken || bridgeAuth.refreshToken || bridgeAuth.token)) {
      void connectWebSocket();
    }
  }
}

function clearBridgeSession(emit = true): void {
  setActiveAuthPatch({
    accessToken: null,
    refreshToken: null,
    authSessionId: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
  }, emit);
}

function buildWsUrl(requestToken: string): string {
  if (!bridgeUrl || !requestToken) return '';
  const base = bridgeUrl.replace(/^http/, 'ws');
  const tokenParam = `?token=${encodeURIComponent(requestToken)}`;
  return `${base}/ws${tokenParam}`;
}

async function postJson<T extends Record<string, unknown>>(
  url: string,
  path: string,
  body?: Record<string, unknown>,
  bearerToken?: string,
  signal?: AbortSignal,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
    signal,
  });
  const data = await res.json() as T;
  return { status: res.status, data };
}

function authPatchFromSession(data: Record<string, unknown>): HostAuthPatch | null {
  const authSession = data.authSession as Record<string, unknown> | undefined;
  if (!authSession || typeof authSession !== 'object') return null;
  const accessToken = typeof authSession.accessToken === 'string' ? authSession.accessToken : '';
  const refreshToken = typeof authSession.refreshToken === 'string' ? authSession.refreshToken : '';
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    authSessionId: typeof authSession.sessionId === 'string' ? authSession.sessionId : null,
    accessTokenExpiresAt: typeof authSession.accessTokenExpiresAt === 'string' ? authSession.accessTokenExpiresAt : null,
    refreshTokenExpiresAt: typeof authSession.refreshTokenExpiresAt === 'string' ? authSession.refreshTokenExpiresAt : null,
  };
}

async function createAuthSession(url: string, pairingToken: string): Promise<HostAuthPatch | null> {
  const { status, data } = await postJson<Record<string, unknown>>(url, '/api/auth/session', undefined, pairingToken);
  if (status === 404) return null;
  if (data.ok !== true) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Unable to create bridge session');
  }
  return authPatchFromSession(data);
}

async function refreshAuthSession(url: string, refreshToken: string): Promise<HostAuthPatch | null> {
  const { status, data } = await postJson<Record<string, unknown>>(url, '/api/auth/refresh', { refreshToken });
  if (status === 404) return null;
  if (data.ok !== true) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Unable to refresh bridge session');
  }
  return authPatchFromSession(data);
}

async function ensureBridgeAccess(forceRefresh = false): Promise<string> {
  if (!bridgeUrl) throw new Error('Bridge URL not set');

  if (!forceRefresh && bridgeAuth.accessToken && !accessNeedsRefresh(bridgeAuth.accessTokenExpiresAt)) {
    return bridgeAuth.accessToken;
  }

  if (bridgeAuth.refreshToken) {
    try {
      const patch = await refreshAuthSession(bridgeUrl, bridgeAuth.refreshToken);
      if (patch) {
        setActiveAuthPatch(patch);
        return patch.accessToken ?? '';
      }
    } catch {
      clearBridgeSession();
    }
  }

  if (bridgeAuth.token) {
    try {
      const patch = await createAuthSession(bridgeUrl, bridgeAuth.token);
      if (patch) {
        setActiveAuthPatch(patch);
        return patch.accessToken ?? '';
      }
      return bridgeAuth.token;
    } catch {
      return bridgeAuth.token;
    }
  }

  return currentRequestToken();
}

async function ensureHostAccess(url: string, auth?: HostAuthInput, forceRefresh = false): Promise<{ token: string; patch?: HostAuthPatch }> {
  const effective = auth ?? {};

  if (!forceRefresh && effective.accessToken && !accessNeedsRefresh(effective.accessTokenExpiresAt)) {
    return { token: effective.accessToken };
  }

  if (effective.refreshToken) {
    try {
      const patch = await refreshAuthSession(url, effective.refreshToken);
      if (patch) {
        emitHostAuthUpdate(effective.hostId, patch);
        return { token: patch.accessToken ?? '', patch };
      }
    } catch {
      emitHostAuthUpdate(effective.hostId, {
        accessToken: null,
        refreshToken: null,
        authSessionId: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      });
    }
  }

  if (effective.token) {
    try {
      const patch = await createAuthSession(url, effective.token);
      if (patch) {
        emitHostAuthUpdate(effective.hostId, patch);
        return { token: patch.accessToken ?? '', patch };
      }
      return { token: effective.token };
    } catch {
      return { token: effective.token };
    }
  }

  return { token: '' };
}

// ── WebSocket connection ──

async function connectWebSocket(): Promise<void> {
  if (ws || wsConnectPromise) return wsConnectPromise ?? Promise.resolve();
  if (!bridgeUrl) return;

  setStatus('connecting');

  wsConnectPromise = (async () => {
    const requestToken = await ensureBridgeAccess();
    const url = buildWsUrl(requestToken);
    if (!url) {
      setStatus('disconnected');
      return;
    }

    try {
      ws = new WebSocket(url);
    } catch {
      setStatus('disconnected');
      scheduleReconnect();
      return;
    }

    const socket = ws;

    socket.onopen = () => {
      if (ws !== socket) {
        intentionallyClosingSockets.add(socket);
        socket.close();
        return;
      }
      wsReady = true;
      setStatus('connected');
      console.log('[daemon:ws] Connected');
    };

    socket.onmessage = (ev) => {
      if (ws !== socket) return;
      try {
        const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
        handleWsMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    socket.onerror = () => {
      // onclose will fire after this
    };

    socket.onclose = () => {
      const intentional = intentionallyClosingSockets.has(socket);
      intentionallyClosingSockets.delete(socket);
      if (ws !== socket) {
        return;
      }
      console.log('[daemon:ws] Disconnected');
      wsReady = false;
      ws = null;

      for (const [, rpc] of pendingRpcs) {
        clearTimeout(rpc.timer);
        rpc.reject(new Error('WebSocket disconnected'));
      }
      pendingRpcs.clear();

      setStatus('disconnected');
      if (!intentional) {
        scheduleReconnect();
      }
    };
  })().finally(() => {
    wsConnectPromise = null;
  });

  return wsConnectPromise;
}

function disconnectWebSocket(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    intentionallyClosingSockets.add(ws);
    wsReady = false;
    const socket = ws;
    ws = null;
    socket.close();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (!bridgeUrl) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!ws && bridgeUrl) {
      void connectWebSocket();
    }
  }, 3000);
}

function handleWsMessage(msg: Record<string, unknown>): void {
  if (typeof msg.id === 'number' && pendingRpcs.has(msg.id)) {
    const pending = pendingRpcs.get(msg.id)!;
    pendingRpcs.delete(msg.id);
    clearTimeout(pending.timer);
    pending.resolve(msg as RpcResponse);
    return;
  }

  if (msg.type === 'output' && typeof msg.sessionId === 'string' && typeof msg.line === 'string') {
    const listeners = outputListeners.get(msg.sessionId);
    if (listeners) {
      for (const fn of listeners) fn(msg.line);
    }
    return;
  }

  if (msg.type === 'ping') {
    if (ws && wsReady) {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }
}

function rpcViaWs(cmd: string, params?: Record<string, unknown>): Promise<RpcResponse> | null {
  if (!ws || !wsReady) return null;

  const id = rpcIdCounter++;
  return new Promise<RpcResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRpcs.delete(id);
      reject(new Error('RPC timeout (30s)'));
    }, 30_000);

    pendingRpcs.set(id, { resolve, reject, timer });

    try {
      ws!.send(JSON.stringify({ id, cmd, ...params }));
    } catch (err) {
      pendingRpcs.delete(id);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// ── Public API ──

export function setBridgeUrl(url: string): void {
  const newUrl = url.replace(/\/$/, '');
  if (newUrl === bridgeUrl) return;
  bridgeUrl = newUrl;
  console.log('[daemon] bridge URL:', bridgeUrl);

  disconnectWebSocket();
  if (bridgeUrl && (currentRequestToken() || bridgeAuth.refreshToken || bridgeAuth.token)) {
    void connectWebSocket();
  }
}

export function setBridgeAuth(auth: HostAuthInput): void {
  const previousToken = currentRequestToken();
  bridgeAuth = preferNewerAuth(bridgeAuth, auth);
  const nextToken = currentRequestToken();
  if (bridgeUrl && previousToken !== nextToken) {
    disconnectWebSocket();
    if (bridgeUrl && (nextToken || bridgeAuth.refreshToken || bridgeAuth.token)) {
      void connectWebSocket();
    }
  }
}

export function setBridgeToken(token: string): void {
  setBridgeAuth({
    ...bridgeAuth,
    token,
  });
}

export async function rpc(cmd: string, params?: Record<string, unknown>): Promise<RpcResponse> {
  const wsResult = rpcViaWs(cmd, params);
  if (wsResult) {
    try {
      const data = await wsResult;
      if (data.ok !== undefined) setStatus('connected');
      return data;
    } catch {
      // WS failed, fall through to HTTP
    }
  }

  return rpcViaHttp(cmd, params);
}

async function rpcViaHttp(cmd: string, params?: Record<string, unknown>): Promise<RpcResponse> {
  if (!bridgeUrl) throw new Error('Bridge URL not set');

  const requestToken = await ensureBridgeAccess();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (requestToken) headers.Authorization = `Bearer ${requestToken}`;
  let res = await fetch(`${bridgeUrl}/api/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ cmd, ...params }),
  });

  if (res.status === 401 && (bridgeAuth.refreshToken || bridgeAuth.token)) {
    const retryToken = await ensureBridgeAccess(true);
    const retryHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (retryToken) retryHeaders.Authorization = `Bearer ${retryToken}`;
    res = await fetch(`${bridgeUrl}/api/rpc`, {
      method: 'POST',
      headers: retryHeaders,
      body: JSON.stringify({ cmd, ...params }),
    });
  }

  const data = await res.json() as RpcResponse;
  if (data.ok !== undefined) setStatus('connected');
  return data;
}

export async function rpcToHost(
  hostUrl: string,
  cmd: string,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
  tokenOrAuth?: string | HostAuthInput,
): Promise<RpcResponse> {
  const url = hostUrl.replace(/\/$/, '');
  let auth = typeof tokenOrAuth === 'string' ? { token: tokenOrAuth } : tokenOrAuth;
  let ensure = await ensureHostAccess(url, auth);
  let { token } = ensure;
  if (ensure.patch && auth) {
    auth = mergeAuthPatch(auth, ensure.patch);
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res = await fetch(`${url}/api/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ cmd, ...params }),
    signal,
  });

  if (res.status === 401 && auth && (auth.refreshToken || auth.token)) {
    ensure = await ensureHostAccess(url, auth, true);
    ({ token } = ensure);
    if (ensure.patch && auth) {
      auth = mergeAuthPatch(auth, ensure.patch);
    }
    const retryHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) retryHeaders.Authorization = `Bearer ${token}`;
    res = await fetch(`${url}/api/rpc`, {
      method: 'POST',
      headers: retryHeaders,
      body: JSON.stringify({ cmd, ...params }),
      signal,
    });
  }

  return await res.json() as RpcResponse;
}

export async function logoutHostSession(host: { url: string } & HostAuthInput): Promise<void> {
  const url = host.url.replace(/\/$/, '');
  const bearer = host.accessToken?.trim() || host.token?.trim() || '';
  if (!bearer && !host.refreshToken) return;
  try {
    await postJson<Record<string, unknown>>(
      url,
      '/api/auth/logout',
      host.refreshToken ? { refreshToken: host.refreshToken } : undefined,
      bearer || undefined,
    );
  } catch {
    // Ignore logout failures on local removal.
  }
}

export function connect(_url: string, _token: string): void {
  if (!ws && bridgeUrl && (currentRequestToken() || bridgeAuth.refreshToken || bridgeAuth.token)) {
    void connectWebSocket();
  }
}

export function disconnect(): void {
  disconnectWebSocket();
  setStatus('disconnected');
}

export function subscribe(sessionId: string, onLine: (line: string) => void): () => void {
  if (!bridgeUrl) return () => {};

  if (ws && wsReady) {
    return subscribeViaWs(sessionId, onLine);
  }

  return subscribeViaSse(sessionId, onLine);
}

function subscribeViaWs(sessionId: string, onLine: (line: string) => void): () => void {
  let listeners = outputListeners.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    outputListeners.set(sessionId, listeners);
  }
  listeners.add(onLine);

  if (ws && wsReady) {
    ws.send(JSON.stringify({ cmd: 'subscribe', sessionId }));
  }

  return () => {
    const set = outputListeners.get(sessionId);
    if (set) {
      set.delete(onLine);
      if (set.size === 0) {
        outputListeners.delete(sessionId);
        if (ws && wsReady) {
          ws.send(JSON.stringify({ cmd: 'unsubscribe', sessionId }));
        }
      }
    }
  };
}

function subscribeViaSse(sessionId: string, onLine: (line: string) => void): () => void {
  const tokenParam = currentRequestToken() ? `?token=${encodeURIComponent(currentRequestToken())}` : '';
  const url = `${bridgeUrl}/api/sessions/${sessionId}/stream${tokenParam}`;
  const es = new EventSource(url);

  es.onmessage = (ev) => {
    onLine(ev.data);
  };

  es.onerror = () => {
    // EventSource auto-reconnects
  };

  return () => {
    es.close();
  };
}

export function isConnected(): boolean {
  return status === 'connected';
}

export function isWebSocketConnected(): boolean {
  return wsReady;
}

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

export function onStatusChange(listener: StatusListener): () => void {
  statusListeners.push(listener);
  return () => {
    statusListeners = statusListeners.filter((l) => l !== listener);
  };
}

export function onHostAuthUpdate(listener: HostAuthListener): () => void {
  hostAuthListeners.push(listener);
  return () => {
    hostAuthListeners = hostAuthListeners.filter((l) => l !== listener);
  };
}

export async function health(): Promise<boolean> {
  try {
    const res = await rpc('health');
    return res.ok === true;
  } catch {
    setStatus('disconnected');
    return false;
  }
}

export function getStreamUrl(sessionId: string): string {
  return `${bridgeUrl}/api/sessions/${sessionId}/stream`;
}
