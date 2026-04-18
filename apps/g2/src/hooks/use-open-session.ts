import { useCallback } from 'react';
import type { WebSession } from '../types';
import { useCreateSession } from './use-create-session';

export function useOpenSession(sessions?: WebSession[]) {
  const createSession = useCreateSession();

  const openSession = useCallback(async (session: WebSession) => {
    if (session.origin !== 'native' || !session.resumeId) {
      return session.id;
    }

    const existing = sessions?.find((candidate) =>
      candidate.origin !== 'native'
      && candidate.hostId === session.hostId
      && candidate.tool === session.tool
      && candidate.workingDirectory === session.workingDirectory
      && candidate.resumeId === session.resumeId,
    );
    if (existing) {
      return existing.id;
    }

    return createSession.mutateAsync({
      tool: session.tool,
      cwd: session.workingDirectory,
      model: session.model,
      hostId: session.hostId,
      conversationId: session.resumeId,
    });
  }, [createSession, sessions]);

  return {
    openSession,
    isPending: createSession.isPending,
  };
}
