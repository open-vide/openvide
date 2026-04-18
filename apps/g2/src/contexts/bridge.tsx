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

export function useBridge() {
  const ctx = useContext(BridgeContext);
  if (!ctx) throw new Error('useBridge must be used within BridgeProvider');
  return ctx;
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
      if (cancelled) return;
      setHosts(loaded);
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
    setHostStatuses(statuses);
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

export function useBridgeUpdate() {
  return useContext(BridgeUpdateContext);
}
