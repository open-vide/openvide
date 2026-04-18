import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { truncate } from 'even-toolkit/text-utils';

import { fieldJoin, SEP } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

export const portBrowserScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const count = snap.ports.length;
    const lines = [
      ...compactHeader(fieldJoin('PORTS', `${count} open`)),
    ];

    if (count === 0) {
      lines.push(line('No open ports', 'meta'));
      return { lines };
    }

    lines.push(
      ...buildScrollableList({
        items: snap.ports,
        highlightedIndex: nav.highlightedIndex,
        maxVisible: 8,
        formatter: (p) => {
          return `:${p.port} ${SEP} ${p.process}`;
        },
      }),
    );

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = Math.max(0, snap.ports.length - 1);
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'GO_BACK') {
      ctx.navigate('/');
      return { ...nav, highlightedIndex: 0 };
    }
    return nav;
  },
};
