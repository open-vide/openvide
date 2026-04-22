import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setBridgeUrl, setBridgeAuth, onStatusChange, onHostAuthUpdate, disconnect, connect, logoutHostSession } from '@/domain/daemon-client';
import { HOSTS_STORAGE_KEY, ACTIVE_HOST_KEY, DEFAULT_POLL_INTERVAL } from '../lib/constants';
import type { WebHost } from '../types';
import { loadHosts, loadHostsSnapshot, persistHosts } from '../lib/host-storage';
import { storageSetRaw, storageRemove, storageGetRaw } from '@/lib/bridge-storage';

interface BridgeContextValue {
  hosts: WebHost[];
  activeHostId: string | null;
  hostStatuses: Record<string, 'connected' | 'disconnected'>;
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  addHost: (name: string, url: string, token?: string) => void;
  removeHost: (hostId: string) => void;
  updateHost: (hostId: string, updates: Partial<WebHost>) => void;
  switchHost: (hostId: string) => void;
  ensureBridgeForSession: (sessionId: string, sessions: Array<{ id: string; hostId?: string }>) => void;
  ensureBridgeForCommand: () => void;
}

const BridgeContext = createContext<BridgeContextValue | null>(null);
const DEV_BOOTSTRAP_HOST_ID = 'dev-bootstrap-host';

export function useBridge() {
  const ctx = useContext(BridgeContext);
  if (!ctx) throw new Error('useBridge must be used within BridgeProvider');
  return ctx;
}

function getDevBootstrapHost(): WebHost | null {
  if (!import.meta.env.DEV) return null;

  const url = import.meta.env.VITE_OPENVIDE_DEV_HOST_URL?.trim().replace(/\/$/, '');
  if (!url) return null;

  const name = import.meta.env.VITE_OPENVIDE_DEV_HOST_NAME?.trim() || 'Dev Bridge';
  const token = import.meta.env.VITE_OPENVIDE_DEV_HOST_TOKEN?.trim();
  return {
    id: DEV_BOOTSTRAP_HOST_ID,
    name,
    url,
    ...(token ? { token } : {}),
  };
}

function mergeDevBootstrapHost(hosts: WebHost[], bootstrap: WebHost | null): { hosts: WebHost[]; host: WebHost | null; changed: boolean; added: boolean } {
  if (!bootstrap) return { hosts, host: null, changed: false, added: false };

  const existingIndex = hosts.findIndex((host) => host.id === bootstrap.id || host.url.replace(/\/$/, '') === bootstrap.url);
  if (existingIndex < 0) {
    return { hosts: [...hosts, bootstrap], host: bootstrap, changed: true, added: true };
  }

  const existing = hosts[existingIndex]!;
  const merged: WebHost = {
    ...existing,
    name: bootstrap.name,
    url: bootstrap.url,
    ...(bootstrap.token ? { token: bootstrap.token } : {}),
  };
  const changed = JSON.stringify(existing) !== JSON.stringify(merged);
  if (!changed) return { hosts, host: existing, changed: false, added: false };

  const next = [...hosts];
  next[existingIndex] = merged;
  return { hosts: next, host: merged, changed: true, added: false };
}

export function BridgeProvider({ children }: { children: ReactNode }) {
  const [hosts, setHosts] = useState<WebHost[]>([]);
  const [activeHostId, setActiveHostId] = useState<string | null>(null);

  // Hydrate hosts + activeHostId from async storage
  useEffect(() => {
    loadHostsSnapshot().then((snapshot) => {
      if (snapshot.length > 0) setHosts(snapshot as WebHost[]);
    }).catch(() => {});
    storageGetRaw(ACTIVE_HOST_KEY).then((val) => {
      if (val) setActiveHostId(val);
    }).catch(() => {});
  }, []);
  const [hostStatuses, setHostStatuses] = useState<Record<string, 'connected' | 'disconnected'>>({});
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');

  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;
  const activeHostIdRef = useRef(activeHostId);
  activeHostIdRef.current = activeHostId;
  const hostStatusesRef = useRef(hostStatuses);
  hostStatusesRef.current = hostStatuses;

  const queryClient = useQueryClient();

  // Listen for daemon-client status changes
  useEffect(() => {
    return onStatusChange((s) => setConnectionStatus(s));
  }, []);

  useEffect(() => {
    return onHostAuthUpdate((hostId, patch) => {
      setHosts((prev) => {
        let changed = false;
        const next = prev.map((host) => {
          if (host.id !== hostId) return host;
          changed = true;
          const updated = { ...host };
          for (const [key, value] of Object.entries(patch)) {
            if (value == null || value === '') {
              delete (updated as Record<string, unknown>)[key];
            } else {
              (updated as Record<string, unknown>)[key] = value;
            }
          }
          return updated;
        });
        if (changed) void persistHosts(next);
        return changed ? next : prev;
      });
    });
  }, []);

  // Set up bridge URL from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bridgeOverride = params.get('bridge');
    if (bridgeOverride) setBridgeUrl(bridgeOverride);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadHosts() as WebHost[];
      const storedActiveHostId = await storageGetRaw(ACTIVE_HOST_KEY).catch(() => null);
      const bootstrap = getDevBootstrapHost();
      const merged = mergeDevBootstrapHost(loaded, bootstrap);
      if (cancelled) return;
      setHosts(merged.hosts);
      if (merged.changed) void persistHosts(merged.hosts);
      const shouldActivateBootstrap = !!merged.host && (!storedActiveHostId || storedActiveHostId === merged.host.id);
      if (merged.host && shouldActivateBootstrap) {
        setActiveHostId(merged.host.id);
        void storageSetRaw(ACTIVE_HOST_KEY, merged.host.id);
        setBridgeUrl(merged.host.url);
        setBridgeAuth({ ...merged.host, hostId: merged.host.id });
        connect('', '');
      }
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['hosts-health'] });
    })();

    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const addHostFn = useCallback((name: string, url: string, token?: string) => {
    const id = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
    const newHost: WebHost = { id, name, url: url.replace(/\/$/, ''), token };
    setHosts((prev) => {
      const next = [...prev, newHost];
      void persistHosts(next);
      return next;
    });
    // Trigger immediate re-poll
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
  }, [queryClient]);

  const removeHostFn = useCallback((hostId: string) => {
    const host = hostsRef.current.find((h) => h.id === hostId);
    if (host) {
      void logoutHostSession({ ...host, hostId: host.id });
    }
    setHosts((prev) => {
      const next = prev.filter((h) => h.id !== hostId);
      void persistHosts(next);
      return next;
    });
    if (activeHostIdRef.current === hostId) {
      storageRemove(ACTIVE_HOST_KEY);
      setActiveHostId(null);
    }
  }, []);

  const updateHostFn = useCallback((hostId: string, updates: Partial<WebHost>) => {
    setHosts((prev) => {
      const next = prev.map((h) => (h.id === hostId ? { ...h, ...updates } : h));
      void persistHosts(next);
      return next;
    });
  }, []);

  const switchHostFn = useCallback((hostId: string) => {
    const host = hostsRef.current.find((h) => h.id === hostId);
    if (!host) return;
    storageSetRaw(ACTIVE_HOST_KEY, hostId);
    setActiveHostId(hostId);
    disconnect();
    setBridgeUrl(host.url);
    setBridgeAuth({ ...host, hostId: host.id });
    connect('', '');
  }, []);

  const ensureBridgeForSession = useCallback(
    (sessionId: string, sessions: Array<{ id: string; hostId?: string }>) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session?.hostId) return;
      const host = hostsRef.current.find((h) => h.id === session.hostId);
      if (host) {
        setBridgeUrl(host.url);
        setBridgeAuth({ ...host, hostId: host.id });
      }
    },
    [],
  );

  const ensureBridgeForCommand = useCallback(() => {
    if (activeHostIdRef.current) {
      const host = hostsRef.current.find((h) => h.id === activeHostIdRef.current);
      if (host) { setBridgeUrl(host.url); setBridgeAuth({ ...host, hostId: host.id }); return; }
    }
    const connectedId = Object.entries(hostStatusesRef.current).find(([, s]) => s === 'connected')?.[0];
    if (connectedId) {
      const host = hostsRef.current.find((h) => h.id === connectedId);
      if (host) { setBridgeUrl(host.url); setBridgeAuth({ ...host, hostId: host.id }); }
    }
  }, []);

  // Update host statuses from polling (called by useSessions hook)
  const updateHostStatuses = useCallback((statuses: Record<string, 'connected' | 'disconnected'>) => {
    setHostStatuses((current) => (sameHostStatuses(current, statuses) ? current : statuses));
  }, []);

  return (
    <BridgeContext.Provider
      value={{
        hosts,
        activeHostId,
        hostStatuses,
        connectionStatus,
        addHost: addHostFn,
        removeHost: removeHostFn,
        updateHost: updateHostFn,
        switchHost: switchHostFn,
        ensureBridgeForSession,
        ensureBridgeForCommand,
      }}
    >
      <BridgeUpdateContext.Provider value={updateHostStatuses}>
        {children}
      </BridgeUpdateContext.Provider>
    </BridgeContext.Provider>
  );
}

// Separate context for updates to avoid re-renders
const BridgeUpdateContext = createContext<(statuses: Record<string, 'connected' | 'disconnected'>) => void>(() => {});

function sameHostStatuses(
  left: Record<string, 'connected' | 'disconnected'>,
  right: Record<string, 'connected' | 'disconnected'>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

export function useBridgeUpdate() {
  return useContext(BridgeUpdateContext);
}
