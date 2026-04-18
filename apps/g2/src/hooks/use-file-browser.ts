import { useQuery } from '@tanstack/react-query';
import { useBridge } from '../contexts/bridge';
import { rpcForHost } from '../lib/bridge-hosts';
import type { BrowserEntry } from '../types';

export function useBrowserEntries(dirPath: string, hostId?: string | null) {
  const { ensureBridgeForCommand, hosts, activeHostId } = useBridge();

  return useQuery<BrowserEntry[]>({
    queryKey: ['fs-list', hostId ?? activeHostId ?? '', dirPath],
    queryFn: async () => {
      ensureBridgeForCommand();
      try {
        const res = await rpcForHost(hosts, hostId ?? activeHostId, 'fs.list', { path: dirPath });
        if (res.ok && Array.isArray(res.entries)) {
          return res.entries as BrowserEntry[];
        }
      } catch { /* ignore */ }
      return [];
    },
    staleTime: 10000,
  });
}

export function useFileContent(filePath: string | null, hostId?: string | null) {
  const { ensureBridgeForCommand, hosts, activeHostId } = useBridge();

  return useQuery<string | null>({
    queryKey: ['fs-read', hostId ?? activeHostId ?? '', filePath],
    queryFn: async () => {
      if (!filePath) return null;
      ensureBridgeForCommand();
      try {
        const res = await rpcForHost(hosts, hostId ?? activeHostId, 'fs.read', { path: filePath });
        if (res.ok && res.fileContent) {
          return (res.fileContent as any).content as string;
        }
      } catch { /* ignore */ }
      return null;
    },
    enabled: !!filePath,
  });
}
