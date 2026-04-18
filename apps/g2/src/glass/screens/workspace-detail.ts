import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { truncate } from 'even-toolkit/text-utils';

import { fieldJoin, DRILL } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

export const workspaceDetailScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const count = snap.workspaces.length;
    const totalRunning = snap.workspaces.reduce((acc, ws) => acc + ws.runningCount, 0);
    const lines = [...compactHeader(fieldJoin('WORKSPACES', `${count}`, totalRunning > 0 ? `${totalRunning} run` : undefined))];

    if (count === 0) {
      lines.push(line('No workspaces', 'meta'));
      return { lines };
    }

    lines.push(...buildScrollableList({
      items: snap.workspaces,
      highlightedIndex: nav.highlightedIndex,
      maxVisible: 8,
      formatter: (ws) => {
        const idleCount = ws.sessionCount - ws.runningCount;
        const parts = [truncate(ws.name, 22), `${ws.sessionCount} ses`];
        if (ws.runningCount > 0) parts.push(`${ws.runningCount} run`);
        if (idleCount > 0) parts.push(`${idleCount} idle`);
        return `${fieldJoin(...parts)} ${DRILL}`;
      },
    }));

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = Math.max(0, snap.workspaces.length - 1);
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      const ws = snap.workspaces[nav.highlightedIndex];
      if (ws) {
        ctx.navigate(`/sessions?workspace=${encodeURIComponent(ws.path)}&host=${ws.hostId ?? ''}`);
      }
      return { ...nav, highlightedIndex: 0 };
    }
    if (action.type === 'GO_BACK') {
      ctx.navigate('/');
      return { ...nav, highlightedIndex: 0 };
    }
    return nav;
  },
};
