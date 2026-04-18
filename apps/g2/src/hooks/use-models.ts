import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/domain/daemon-client';
import type { ModelInfo } from '../types';

export function useModels() {
  return useQuery<ModelInfo[]>({
    queryKey: ['models'],
    queryFn: async () => {
      const res = await rpc('model.list', { tool: 'codex' });
      if (res.ok && Array.isArray(res.models)) {
        return res.models as ModelInfo[];
      }
      return [];
    },
    staleTime: 60000,
  });
}
