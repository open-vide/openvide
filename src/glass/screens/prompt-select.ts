import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { truncate } from 'even-toolkit/text-utils';

import { fieldJoin, drillLabel } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

export const promptSelectScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const count = snap.prompts.length;
    // First item is always Voice Input, then prompts
    const allItems = [
      { id: '__voice__', label: 'Voice Input', prompt: '', isBuiltIn: true },
      ...snap.prompts,
    ];

    const lines = [
      ...compactHeader(fieldJoin('PROMPTS', `${count}`)),
      ...buildScrollableList({
        items: allItems,
        highlightedIndex: nav.highlightedIndex,
        maxVisible: 8,
        formatter: (p) => {
          if (p.id === '__voice__') return 'Voice Input';
          return drillLabel(truncate(p.label, 40));
        },
      }),
    ];

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    const totalItems = snap.prompts.length + 1;
    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = Math.max(0, totalItems - 1);
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      if (nav.highlightedIndex === 0) {
        ctx.startVoice();
        return nav;
      }
      const prompt = snap.prompts[nav.highlightedIndex - 1];
      if (prompt && snap.selectedSessionId) {
        ctx.rpc('session.send', { id: snap.selectedSessionId, prompt: prompt.prompt });
        ctx.navigate(`/chat?id=${snap.selectedSessionId}`);
      }
      return { ...nav, highlightedIndex: 0 };
    }
    if (action.type === 'GO_BACK') {
      ctx.navigate('/sessions');
      return { ...nav, highlightedIndex: 0 };
    }
    return nav;
  },
};
