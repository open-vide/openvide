import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { truncate } from 'even-toolkit/text-utils';
import { fieldJoin, DRILL } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

type SessionListItem =
  | { kind: 'create'; cwd: string }
  | ({ kind: 'session' } & OpenVideSnapshot['sessions'][number]);

function getFilteredSessions(snap: OpenVideSnapshot) {
  return snap.selectedWorkspace
    ? snap.sessions.filter((session) => session.workingDirectory === snap.selectedWorkspace)
    : snap.sessions;
}

function getSessionItems(snap: OpenVideSnapshot): SessionListItem[] {
  const filteredSessions = getFilteredSessions(snap);
  return [
    { kind: 'create', cwd: snap.selectedWorkspace ?? '~' },
    ...filteredSessions.map((session) => ({ kind: 'session' as const, ...session })),
  ];
}

function isSelectedHostConnected(snap: OpenVideSnapshot): boolean {
  const selectedHostId = snap.selectedWorkspaceHostId ?? snap.selectedHostId ?? null;
  if (!selectedHostId) {
    return snap.hosts.some((host) => snap.hostStatuses[host.id] === 'connected');
  }
  return snap.hostStatuses[selectedHostId] === 'connected';
}

export const sessionListScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const filtered = getFilteredSessions(snap);
    const items = getSessionItems(snap);

    const count = filtered.length;
    const running = filtered.filter(s => s.status === 'running').length;
    const idle = filtered.filter(s => s.status === 'idle').length;

    // Show workspace name in header if filtered
    const wsName = snap.selectedWorkspace?.split('/').pop();
    const headerParts = wsName ? [wsName.toUpperCase(), `${count}`] : ['SESSIONS', `${count}`];
    if (running > 0) headerParts.push(`${running} run`);
    if (idle > 0) headerParts.push(`${idle} idle`);

    const showOfflineWarning = !isSelectedHostConnected(snap);
    const lines = [...compactHeader(fieldJoin(...headerParts), undefined, showOfflineWarning ? '! offline' : undefined)];

    lines.push(...buildScrollableList({
      items,
      highlightedIndex: nav.highlightedIndex,
      maxVisible: 8,
      formatter: (item) => {
        if (item.kind === 'create') {
          const cwd = item.cwd.split('/').filter(Boolean).pop() ?? item.cwd;
          return `${fieldJoin('new', truncate(cwd || '~', 18), 'start')} ${DRILL}`;
        }
        const s = item;
        const tool = s.tool.slice(0, 6);
        const st = s.status === 'running' ? 'run' : s.status.slice(0, 4);
        const dir = s.workingDirectory.split('/').pop() ?? '';
        const model = s.model ? truncate(s.model, 8) : '';
        return `${fieldJoin(tool, st, truncate(dir, 18), model)} ${DRILL}`;
      },
    }));

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    const items = getSessionItems(snap);

    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = Math.max(0, items.length - 1);
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      const selected = items[nav.highlightedIndex];
      if (selected?.kind === 'session') {
        if (selected.origin === 'native' && selected.resumeId) {
          const hostId = selected.hostId ?? snap.selectedWorkspaceHostId ?? snap.selectedHostId ?? snap.hosts[0]?.id;
          void (async () => {
            const createRes = await ctx.rpc('session.create', {
              hostId,
              tool: selected.tool,
              cwd: selected.workingDirectory,
              model: selected.model,
              conversationId: selected.resumeId,
              autoAccept: true,
            });
            const sessionId = typeof createRes?.session?.id === 'string' ? createRes.session.id : null;
            if (sessionId) {
              ctx.navigate(`/chat?id=${encodeURIComponent(sessionId)}`);
            }
          })();
        } else {
          ctx.navigate(`/chat?id=${selected.id}`);
        }
      } else if (selected?.kind === 'create') {
        // Hand off to the tool-picker screen so the user chooses
        // claude / codex / gemini before the session spawns.
        ctx.navigate('/tool-picker');
      }
      return { ...nav, highlightedIndex: 0 };
    }
    if (action.type === 'GO_BACK') {
      ctx.navigate(snap.selectedWorkspace ? '/workspace' : '/');
      return { ...nav, highlightedIndex: 0 };
    }
    return nav;
  },
};
