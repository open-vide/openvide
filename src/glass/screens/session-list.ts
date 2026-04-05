import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { truncate } from 'even-toolkit/text-utils';
import { fieldJoin, DRILL } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

export const sessionListScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    // Filter by workspace if set
    const filtered = snap.selectedWorkspace
      ? snap.sessions.filter(s => s.workingDirectory === snap.selectedWorkspace)
      : snap.sessions;

    const count = filtered.length;
    const running = filtered.filter(s => s.status === 'running').length;
    const idle = filtered.filter(s => s.status === 'idle').length;

    // Show workspace name in header if filtered
    const wsName = snap.selectedWorkspace?.split('/').pop();
    const headerParts = wsName ? [wsName.toUpperCase(), `${count}`] : ['SESSIONS', `${count}`];
    if (running > 0) headerParts.push(`${running} run`);
    if (idle > 0) headerParts.push(`${idle} idle`);

    const lines = [...compactHeader(fieldJoin(...headerParts))];

    if (count === 0) {
      lines.push(line('No sessions', 'meta'));
      return { lines };
    }

    lines.push(...buildScrollableList({
      items: filtered,
      highlightedIndex: nav.highlightedIndex,
      maxVisible: 8,
      formatter: (s) => {
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
    const filtered = snap.selectedWorkspace
      ? snap.sessions.filter(s => s.workingDirectory === snap.selectedWorkspace)
      : snap.sessions;

    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = Math.max(0, filtered.length - 1);
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      const session = filtered[nav.highlightedIndex];
      if (session) {
        ctx.navigate(`/chat?id=${session.id}`);
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
