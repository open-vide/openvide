import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { truncate } from 'even-toolkit/text-utils';

import { DASH } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

export const actionResultScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const result = snap.pendingResult;
    if (!result) {
      return {
        lines: [
          ...compactHeader('RESULT'),
          line('No result', 'meta'),
          line(''),
          line(' Continue', undefined, true),
        ],
      };
    }

    const lines = [
      ...compactHeader('RESULT'),
      line(''),
      line(`${result.action.toUpperCase()} ${DASH} ${result.success ? 'OK' : 'FAILED'}`),
      line(''),
      line(`"${truncate(result.message, 38)}"`),
      line(''),
      line('Continue', undefined, true),
    ];

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    if (action.type === 'SELECT_HIGHLIGHTED') {
      ctx.navigate(snap.sessions.length > 0 ? '/sessions' : '/');
      return { ...nav, highlightedIndex: 0 };
    }
    if (action.type === 'GO_BACK') {
      ctx.navigate(snap.sessions.length > 0 ? '/sessions' : '/');
      return { ...nav, highlightedIndex: 0 };
    }
    return nav;
  },
};
