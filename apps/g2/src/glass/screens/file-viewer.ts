import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { truncate, applyScrollIndicators } from 'even-toolkit/text-utils';
import { fieldJoin } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

export const fileViewerScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const fileName = snap.browserPath.split('/').pop() ?? 'file';
    const contentLines = snap.outputLines.length > 0
      ? snap.outputLines
      : [truncate(snap.browserPath, 40), '', 'Use web UI for full file view'];

    const headerLines = compactHeader(fieldJoin('FILE', truncate(fileName, 28)));
    const contentSlots = 8; // 10 - 2 (title + separator)
    const start = Math.max(0, Math.min(nav.highlightedIndex, contentLines.length - contentSlots));
    const visible = contentLines.slice(start, start + contentSlots);
    const displayLines = visible.map(t => line(t, 'meta'));
    applyScrollIndicators(displayLines, start, contentLines.length, contentSlots, t => line(t, 'meta'));

    return { lines: [...headerLines, ...displayLines] };
  },

  action: (action, nav, snap, ctx) => {
    if (action.type === 'HIGHLIGHT_MOVE') {
      const idx = action.direction === 'down'
        ? nav.highlightedIndex + 1
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'GO_BACK') {
      const parentPath = snap.browserPath.replace(/\/[^/]+$/, '') || '~';
      ctx.navigate(`/files?path=${encodeURIComponent(parentPath)}`);
      return { ...nav, highlightedIndex: 0 };
    }
    return nav;
  },
};
