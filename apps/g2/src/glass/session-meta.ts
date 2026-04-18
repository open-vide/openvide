import type { OpenVideSnapshot } from './types';

type SessionMeta = {
  tool?: string;
  model?: string;
  status?: string;
};

const lastKnownSessionMeta = new Map<string, SessionMeta>();

export function resolveGlassSessionMeta(snap: OpenVideSnapshot): SessionMeta {
  const sessionId = snap.selectedSessionId;
  if (!sessionId) return {};

  const session = snap.sessions.find((entry) => entry.id === sessionId);
  if (session) {
    const meta: SessionMeta = {
      tool: session.tool,
      model: session.model,
      status: session.status,
    };
    lastKnownSessionMeta.set(sessionId, meta);
    return meta;
  }

  return lastKnownSessionMeta.get(sessionId) ?? {};
}
