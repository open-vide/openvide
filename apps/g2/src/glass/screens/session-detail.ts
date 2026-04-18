import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line, separator } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { truncate } from 'even-toolkit/text-utils';

import { fieldJoin, drillLabel } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

interface DetailAction {
  id: string;
  label: string;
  path?: string;
}

function getActions(snap: OpenVideSnapshot): DetailAction[] {
  const session = snap.sessions.find(s => s.id === snap.selectedSessionId);
  if (!session) return [];

  const actions: DetailAction[] = [
    { id: 'chat', label: 'Enter Chat', path: `/chat?id=${session.id}` },
  ];

  if (session.status !== 'running') {
    actions.push({ id: 'diffs', label: 'View Diffs', path: `/diffs?id=${session.id}` });
  }
  if (session.status === 'running') {
    actions.push({ id: 'cancel', label: 'Cancel Session' });
  }
  actions.push({ id: 'delete', label: 'Delete Session' });

  return actions;
}

export const sessionDetailScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const session = snap.sessions.find(s => s.id === snap.selectedSessionId);
    if (!session) {
      return {
        lines: [
          ...compactHeader('SESSION'),
          line('Session not found', 'meta'),
        ],
      };
    }

    const tool = session.tool.toUpperCase();
    const status = session.status;
    const lines = [...compactHeader(fieldJoin(tool, status))];

    const dirName = session.workingDirectory.split('/').pop() ?? '';
    const model = session.model ?? '';
    if (dirName || model) lines.push(line(fieldJoin(dirName, model), 'meta'));
    if (session.lastPrompt) {
      lines.push(line(`"${truncate(session.lastPrompt, 38)}"`, 'meta'));
    }

    lines.push(separator());

    const actions = getActions(snap);
    lines.push(...buildScrollableList({
      items: actions,
      highlightedIndex: nav.highlightedIndex,
      maxVisible: 4,
      formatter: (a) => a.path ? drillLabel(a.label) : a.label,
    }));

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    const actions = getActions(snap);
    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = Math.max(0, actions.length - 1);
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      const chosen = actions[nav.highlightedIndex];
      if (!chosen) return nav;

      if (chosen.path) {
        ctx.navigate(chosen.path);
        return { ...nav, highlightedIndex: 0 };
      }
      if (chosen.id === 'cancel' && snap.selectedSessionId) {
        ctx.rpc('session.cancel', { id: snap.selectedSessionId });
        return nav;
      }
      if (chosen.id === 'delete' && snap.selectedSessionId) {
        ctx.rpc('session.remove', { id: snap.selectedSessionId });
        ctx.navigate('/sessions');
        return { ...nav, highlightedIndex: 0 };
      }
      return nav;
    }
    if (action.type === 'GO_BACK') {
      ctx.navigate('/sessions');
      return { ...nav, highlightedIndex: 0 };
    }
    return nav;
  },
};
