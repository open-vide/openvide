import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildStaticActionBar } from 'even-toolkit/action-bar';
import { fieldJoin } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';
import { resolveGlassSessionMeta } from '../session-meta';

const ACTIONS = ['Confirm', 'Cancel'];

export const voiceInputScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const sessionMeta = resolveGlassSessionMeta(snap);
    const tool = sessionMeta.tool?.toUpperCase() ?? 'AI';
    const actionBar = buildStaticActionBar(ACTIONS, Math.max(0, Math.min(nav.highlightedIndex, ACTIONS.length - 1)));
    const lines = [
      ...compactHeader(fieldJoin('VOICE', tool), actionBar),
    ];

    if (snap.voiceListening) {
      lines.push(line('Listening...', 'meta'));
    } else {
      lines.push(line(snap.voiceText ? 'Ready to send' : 'Processing...', 'meta'));
    }

    lines.push(line(''));

    if (snap.voiceText) {
      // Word-wrap transcription to fit G2 display
      const words = snap.voiceText.split(' ');
      let current = '';
      for (const word of words) {
        if (current.length + word.length + 1 > 38) {
          lines.push(line(current));
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) lines.push(line(current));
    }

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    if (action.type === 'HIGHLIGHT_MOVE') {
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, ACTIONS.length - 1)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      if (nav.highlightedIndex === 0) {
        void ctx.submitVoice(snap.voiceText ?? '');
      } else {
        ctx.stopVoice();
      }
      return { ...nav, highlightedIndex: 0 };
    }
    if (action.type === 'GO_BACK') {
      ctx.stopVoice();
      return { ...nav, highlightedIndex: 0 };
    }
    return nav;
  },
};
