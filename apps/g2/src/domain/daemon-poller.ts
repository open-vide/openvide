/**
 * Polls ALL configured hosts for session lists and dispatches aggregated updates.
 * Falls back to single-host polling if no hosts are configured.
 */

import type { Store } from '../state/store';
import type { SessionSummary, Workspace } from '../state/types';
import { rpc, rpcToHost, onStatusChange, isWebSocketConnected } from './daemon-client';
import { fetchHosts } from './host-store';

/** Shallow-compare two arrays of objects by JSON snapshot. Avoids re-renders when data is unchanged. */
function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function objectsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let statusUnsub: (() => void) | null = null;

function mapSessions(raw: unknown[], hostId?: string): SessionSummary[] {
  return raw
    .map((s: any) => ({
      id: s.id,
      hostId,
      tool: s.tool,
      status: s.status,
      workingDirectory: s.workingDirectory,
      model: s.model,
      lastPrompt: s.lastTurn?.prompt,
      lastError: s.lastTurn?.error,
      updatedAt: s.updatedAt,
      outputLines: s.outputLines ?? 0,
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** Extract workspaces from sessions, keyed by hostId + path. */
function extractWorkspaces(sessions: SessionSummary[]): Workspace[] {
  const map = new Map<string, Workspace>();
  for (const s of sessions) {
    const key = `${s.hostId ?? ''}:${s.workingDirectory}`;
    const existing = map.get(key);
    if (existing) {
      existing.sessionCount++;
      if (s.status === 'running') existing.runningCount++;
    } else {
      map.set(key, {
        path: s.workingDirectory,
        hostId: s.hostId,
        name: s.workingDirectory.split('/').pop() ?? s.workingDirectory,
        sessionCount: 1,
        runningCount: s.status === 'running' ? 1 : 0,
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.runningCount !== b.runningCount) return b.runningCount - a.runningCount;
    return b.sessionCount - a.sessionCount;
  });
}

/** Poll a single host with a timeout. */
async function pollHost(
  hostUrl: string,
  hostId: string,
  auth?: {
    token?: string;
    accessToken?: string;
    refreshToken?: string;
    authSessionId?: string;
    accessTokenExpiresAt?: string;
    refreshTokenExpiresAt?: string;
  },
  timeoutMs = 3000,
): Promise<{ hostId: string; sessions: SessionSummary[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await rpcToHost(hostUrl, 'session.list', undefined, controller.signal, {
      hostId,
      ...auth,
    });
    clearTimeout(timer);
    if (res.ok && Array.isArray(res.sessions)) {
      return { hostId, sessions: mapSessions(res.sessions as unknown[], hostId) };
    }
    return { hostId, sessions: [] };
  } catch {
    clearTimeout(timer);
    return { hostId, sessions: [] };
  }
}

/** Poll all configured hosts in parallel. */
async function pollAllHosts(store: Store): Promise<void> {
  const state = store.getState();
  const hosts = state.hosts;

  if (hosts.length === 0) {
    // No hosts configured — fall back to single-bridge polling
    return pollSingleHost(store);
  }

  const results = await Promise.allSettled(
    hosts.map((h) => pollHost(h.url, h.id, {
      token: h.token,
      accessToken: h.accessToken,
      refreshToken: h.refreshToken,
      authSessionId: h.authSessionId,
      accessTokenExpiresAt: h.accessTokenExpiresAt,
      refreshTokenExpiresAt: h.refreshTokenExpiresAt,
    }))
  );

  const hostStatuses: Record<string, 'connected' | 'disconnected'> = {};
  let allSessions: SessionSummary[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { hostId, sessions } = r.value;
      hostStatuses[hostId] = sessions.length > 0 || r.value.sessions !== undefined ? 'connected' : 'disconnected';
      allSessions.push(...sessions);
    }
  }

  // Re-check: mark hosts as connected if pollHost succeeded (even with 0 sessions)
  for (const r of results) {
    if (r.status === 'fulfilled') {
      hostStatuses[r.value.hostId] = 'connected';
    } else {
      // Find which host failed — allSettled preserves order
      const idx = results.indexOf(r);
      if (idx >= 0 && hosts[idx]) {
        hostStatuses[hosts[idx].id] = 'disconnected';
      }
    }
  }

  // Sort all sessions by updatedAt
  allSessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // Derive workspaces
  const workspaces = extractWorkspaces(allSessions);
  const currentState = store.getState();

  // Only dispatch if data actually changed — prevents constant re-renders on glasses
  if (!arraysEqual(workspaces, currentState.workspaces)) {
    store.dispatch({ type: 'WORKSPACES_UPDATED', workspaces });
  }
  if (!objectsEqual(hostStatuses, currentState.hostStatuses ?? {})) {
    store.dispatch({ type: 'HOST_STATUSES_UPDATED', statuses: hostStatuses });
  }

  // Filter by selected workspace if applicable
  const sessionsToDispatch = currentState.selectedWorkspace
    ? allSessions.filter((s) =>
        s.workingDirectory === currentState.selectedWorkspace &&
        (!currentState.selectedWorkspaceHostId || s.hostId === currentState.selectedWorkspaceHostId)
      )
    : allSessions;

  if (!arraysEqual(sessionsToDispatch, currentState.sessions)) {
    store.dispatch({ type: 'SESSIONS_UPDATED', sessions: sessionsToDispatch });
  }

  // Overall connection status
  const anyConnected = Object.values(hostStatuses).some((s) => s === 'connected');
  const newStatus = anyConnected ? 'connected' : 'disconnected';
  if (currentState.connectionStatus !== newStatus) {
    store.dispatch({ type: 'CONNECTION_STATUS', status: newStatus });
  }

  // Fetch hosts on first successful connection
  if (anyConnected && currentState.connectionStatus !== 'connected') {
    fetchHosts(store);
  }

}

/** Legacy single-host polling (no hosts configured). */
async function pollSingleHost(store: Store): Promise<void> {
  try {
    const res = await rpc('session.list');
    if (res.ok && Array.isArray(res.sessions)) {
      const allSessions = mapSessions(res.sessions as unknown[]);
      const state = store.getState();
      const workspaces = extractWorkspaces(allSessions);

      if (!arraysEqual(workspaces, state.workspaces)) {
        store.dispatch({ type: 'WORKSPACES_UPDATED', workspaces });
      }

      const sessionsToDispatch = state.selectedWorkspace
        ? allSessions.filter((s) => s.workingDirectory === state.selectedWorkspace)
        : allSessions;

      if (!arraysEqual(sessionsToDispatch, state.sessions)) {
        store.dispatch({ type: 'SESSIONS_UPDATED', sessions: sessionsToDispatch });
      }

      if (state.connectionStatus !== 'connected') {
        store.dispatch({ type: 'CONNECTION_STATUS', status: 'connected' });
        fetchHosts(store);
      }
    } else {
      if (store.getState().connectionStatus !== 'disconnected') {
        store.dispatch({ type: 'CONNECTION_STATUS', status: 'disconnected' });
      }
    }
  } catch {
    if (store.getState().connectionStatus !== 'disconnected') {
      store.dispatch({ type: 'CONNECTION_STATUS', status: 'disconnected' });
    }
  }
}

export function startPolling(store: Store, intervalMs = 2500): void {
  if (pollTimer) return;
  console.log('[poller] Starting multi-host polling every', intervalMs, 'ms');

  statusUnsub = onStatusChange((wsStatus) => {
    const state = store.getState();
    if (wsStatus !== state.connectionStatus) {
      store.dispatch({ type: 'CONNECTION_STATUS', status: wsStatus });
    }
  });

  pollAllHosts(store);
  pollTimer = setInterval(() => pollAllHosts(store), intervalMs);
}

export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (statusUnsub) {
    statusUnsub();
    statusUnsub = null;
  }
}
