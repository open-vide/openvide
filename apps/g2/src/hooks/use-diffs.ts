import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/domain/daemon-client';
import { useBridge } from '../contexts/bridge';
import type { DiffFile } from '../types';

export function useDiffs(sessionId: string | undefined, sessions?: Array<{ id: string; hostId?: string }>) {
  const { ensureBridgeForSession } = useBridge();

  return useQuery<DiffFile[]>({
    queryKey: ['diffs', sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      if (sessions) ensureBridgeForSession(sessionId, sessions);
      try {
        const res = await rpc('session.diffs', { id: sessionId });
        if (res.ok && Array.isArray(res.files)) {
          return res.files as DiffFile[];
        }
      } catch { /* ignore */ }
      return [];
    },
    enabled: !!sessionId,
    staleTime: 5000,
  });
}

export function useFileDiff(sessionId: string | undefined, filePath: string | null) {
  return useQuery<string | null>({
    queryKey: ['diff-file', sessionId, filePath],
    queryFn: async () => {
      if (!sessionId || !filePath) return null;
      try {
        const res = await rpc('session.diff_file', { id: sessionId, path: filePath });
        if (res.ok && typeof res.content === 'string') {
          return res.content;
        }
      } catch { /* ignore */ }
      return null;
    },
    enabled: !!sessionId && !!filePath,
  });
}
