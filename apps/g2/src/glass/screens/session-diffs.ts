import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { truncate } from 'even-toolkit/text-utils';

import { fieldJoin, SEP } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

export const sessionDiffsScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const count = snap.diffFiles.length;
    const totalAdded = snap.diffFiles.reduce((a, f) => a + (f.added ?? 0), 0);
    const totalRemoved = snap.diffFiles.reduce((a, f) => a + (f.removed ?? 0), 0);
    const statsStr = totalAdded || totalRemoved ? `+${totalAdded} -${totalRemoved}` : undefined;
    const lines = [
      ...compactHeader(fieldJoin('DIFFS', `${count} files`, statsStr)),
    ];

    if (count === 0) {
      lines.push(line('Loading...', 'meta'));
      return { lines };
    }

    lines.push(
      ...buildScrollableList({
        items: snap.diffFiles,
        highlightedIndex: nav.highlightedIndex,
        maxVisible: 8,
        formatter: (f) => {
          return `${f.isNew ? `NEW ${SEP} ` : ''}${truncate(f.path, 28)} ${SEP} +${f.added}${f.removed ? ` -${f.removed}` : ''}`;
        },
      }),
    );

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = Math.max(0, snap.diffFiles.length - 1);
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'GO_BACK') {
      ctx.navigate('/sessions');
      return { ...nav, highlightedIndex: 0 };
    }
    return nav;
  },
};
