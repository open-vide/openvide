import type { WebSession } from '../types';

export type SessionFilter = 'all' | 'running' | 'idle' | 'failed' | 'scheduled' | 'team';

export function isScheduledSession(
  session: Pick<WebSession, 'runKind' | 'scheduleId' | 'scheduleName'> | null | undefined,
): boolean {
  return session?.runKind === 'scheduled' || Boolean(session?.scheduleId) || Boolean(session?.scheduleName);
}

export function isTeamSession(
  session: Pick<WebSession, 'runKind' | 'teamId' | 'teamName'> | null | undefined,
): boolean {
  return session?.runKind === 'team' || Boolean(session?.teamId) || Boolean(session?.teamName);
}

export function isFailedSession(session: Pick<WebSession, 'status'>): boolean {
  return session.status === 'error' || session.status === 'failed';
}

export function filterSessionsByChip(sessions: WebSession[], filter: SessionFilter): WebSession[] {
  if (filter === 'scheduled') {
    return sessions.filter(isScheduledSession);
  }
  if (filter === 'team') {
    return sessions.filter(isTeamSession);
  }

  const visible = sessions.filter((session) => !isScheduledSession(session) && !isTeamSession(session));
  if (filter === 'all') return visible;
  if (filter === 'running') return visible.filter((session) => session.status === 'running');
  if (filter === 'failed') return visible.filter(isFailedSession);
  return visible.filter((session) => session.status !== 'running' && !isFailedSession(session));
}
