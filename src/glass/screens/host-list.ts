import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { truncate } from 'even-toolkit/text-utils';

import { fieldJoin, SEP, DRILL } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

export const hostListScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const count = snap.hosts.length;
    const connected = snap.hosts.filter(h => snap.hostStatuses[h.id] === 'connected').length;
    const lines = [...compactHeader(fieldJoin('HOSTS', `${connected} on`, `${count} total`))];

    if (count === 0) {
      lines.push(line('No hosts configured', 'meta'));
      return { lines };
    }

    lines.push(...buildScrollableList({
      items: snap.hosts,
      highlightedIndex: nav.highlightedIndex,
      maxVisible: 8,
      formatter: (h) => {
        const st = snap.hostStatuses[h.id] ?? 'disconnected';
        const tag = st === 'connected' ? 'on' : 'off';
        const hostSessions = snap.sessions.filter(s => s.hostId === h.id).length;
        const sesInfo = hostSessions > 0 ? `${hostSessions} ses` : undefined;
        return `${fieldJoin(truncate(h.name, 24), tag, sesInfo)} ${DRILL}`;
      },
    }));

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = Math.max(0, snap.hosts.length - 1);
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      const host = snap.hosts[nav.highlightedIndex];
      if (host) {
        ctx.switchHost(host.id);
        ctx.navigate(`/workspace?host=${host.id}`);
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
