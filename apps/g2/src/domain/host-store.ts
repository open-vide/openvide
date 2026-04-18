/**
 * Host management via SDK bridge storage.
 */

import type { Host } from '../state/types';
import type { Store } from '../state/store';
import { loadHosts, loadHostsSnapshot, persistHosts } from '../lib/host-storage';

/** Load hosts from SDK storage and dispatch to store. */
export function fetchHosts(store: Store): void {
  void (async () => {
    const snapshot = await loadHostsSnapshot() as Host[];
    store.dispatch({ type: 'HOSTS_LOADED', hosts: snapshot });
    const hosts = await loadHosts() as Host[];
    store.dispatch({ type: 'HOSTS_LOADED', hosts });
  })();
}

/** Add a host and persist. */
export async function addHost(store: Store, name: string, url: string): Promise<boolean> {
  const hosts = await loadHostsSnapshot() as Host[];
  const host: Host = {
    id: crypto.randomUUID(),
    name,
    url: url.replace(/\/$/, ''),
  };
  hosts.push(host);
  void persistHosts(hosts);
  store.dispatch({ type: 'HOST_ADD', host });
  return true;
}

/** Remove a host and persist. */
export async function removeHost(store: Store, hostId: string): Promise<boolean> {
  const hosts = (await loadHostsSnapshot() as Host[]).filter((h) => h.id !== hostId);
  void persistHosts(hosts);
  store.dispatch({ type: 'HOST_REMOVE', hostId });
  return true;
}
