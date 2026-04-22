import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildStaticActionBar } from 'even-toolkit/action-bar';
import { fieldJoin, DRILL } from 'even-toolkit/glass-format';
import { truncate } from 'even-toolkit/text-utils';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

type Tool = 'claude' | 'codex' | 'gemini';

/**
 * Tool picker shown when the user creates a new session from the glasses.
 * Scroll moves the highlight between Claude / Codex / Gemini. Tap selects the
 * tool and spawns a fresh session in the active workspace. Double-tap returns.
 */

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini' },
];

export const toolPickerScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const idx = Math.max(0, Math.min(nav.highlightedIndex, TOOLS.length - 1));
    const cwd = snap.selectedWorkspace ?? '~';
    const cwdName = cwd.split('/').filter(Boolean).pop() ?? cwd;
    const actionBar = buildStaticActionBar(['Pick'], 0);
    const lines = [
      ...compactHeader(fieldJoin('NEW', truncate(cwdName, 16)), actionBar),
      line('Select a CLI tool', 'meta'),
      line(''),
    ];
    for (let i = 0; i < TOOLS.length; i += 1) {
      const tool = TOOLS[i]!;
      const marker = i === idx ? '▸' : ' ';
      lines.push(line(`${marker} ${tool.label} ${i === idx ? DRILL : ''}`.trim()));
    }
    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    if (action.type === 'HIGHLIGHT_MOVE') {
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, TOOLS.length - 1)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }

    if (action.type === 'SELECT_HIGHLIGHTED') {
      const idx = Math.max(0, Math.min(nav.highlightedIndex, TOOLS.length - 1));
      const tool = TOOLS[idx]!.id;
      const hostId = snap.selectedWorkspaceHostId ?? snap.selectedHostId ?? snap.hosts[0]?.id;
      void (async () => {
        const bridgeRes = await ctx.rpc('bridge.config', hostId ? { hostId } : undefined);
        if (!bridgeRes?.ok) return;
        const bridgeConfig = (bridgeRes.bridgeConfig ?? {}) as { defaultCwd?: string };
        const cwd = snap.selectedWorkspace ?? bridgeConfig.defaultCwd?.trim() ?? '~';
        const params: Record<string, unknown> = {
          hostId,
          tool,
          cwd,
          autoAccept: true,
        };
        if (tool === 'codex' && snap.settings.codexPermissionMode === 'ask') {
          params.permissionMode = 'ask';
        }
        const createRes = await ctx.rpc('session.create', params);
        const sessionId = typeof createRes?.session?.id === 'string' ? createRes.session.id : null;
        if (sessionId) {
          ctx.navigate(`/chat?id=${encodeURIComponent(sessionId)}`);
        }
      })();
      return { ...nav, highlightedIndex: 0 };
    }

    if (action.type === 'GO_BACK') {
      ctx.navigate('/sessions');
      return { ...nav, highlightedIndex: 0 };
    }

    return nav;
  },
};
