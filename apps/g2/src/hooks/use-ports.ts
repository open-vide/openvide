import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/domain/daemon-client';
import type { PortEntry } from '../types';

export function usePorts() {
  return useQuery<PortEntry[]>({
    queryKey: ['ports'],
    queryFn: async () => {
      try {
        const res = await rpc('ports.list');
        if (res.ok && Array.isArray(res.ports)) {
          return res.ports as PortEntry[];
        }
      } catch { /* ignore */ }
      return [];
    },
    staleTime: 5000,
  });
}
