import { useMemo } from 'react';
import type { WebSession, WebWorkspace } from '../types';

export function useWorkspaces(sessions: WebSession[] | undefined): WebWorkspace[] {
  return useMemo(() => {
    if (!sessions) return [];
    const wsMap = new Map<string, WebWorkspace>();
    for (const s of sessions) {
      const key = `${s.hostId ?? ''}:${s.workingDirectory}`;
      const existing = wsMap.get(key);
      if (existing) {
        existing.sessionCount++;
        if (s.status === 'running' || s.status === 'awaiting_approval') existing.runningCount++;
      } else {
        wsMap.set(key, {
          path: s.workingDirectory,
          hostId: s.hostId,
          name: s.workingDirectory.split('/').pop() ?? s.workingDirectory,
          sessionCount: 1,
          runningCount: s.status === 'running' || s.status === 'awaiting_approval' ? 1 : 0,
        });
      }
    }
    return [...wsMap.values()].sort(
      (a, b) => b.runningCount - a.runningCount || b.sessionCount - a.sessionCount,
    );
  }, [sessions]);
}
