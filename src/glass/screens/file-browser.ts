import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line, separator } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { truncate } from 'even-toolkit/text-utils';

import { fieldJoin, drillLabel, SEP, DRILL } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function getSortedEntries(snap: OpenVideSnapshot) {
  const filtered = snap.settings.showHiddenFiles
    ? snap.browserEntries
    : snap.browserEntries.filter(e => !e.name.startsWith('.'));

  return [...filtered].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export const fileBrowserScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const pathDisplay = snap.browserPath.length > 28
      ? '...' + snap.browserPath.slice(-25)
      : snap.browserPath;
    const hostLabel = snap.selectedHostId
      ? snap.hosts.find((host) => host.id === snap.selectedHostId)?.name ?? 'host'
      : 'host';
    const hasHostPicker = snap.hosts.length > 1;
    const sorted = getSortedEntries(snap);
    const allItems = [
      ...(hasHostPicker ? [{ kind: 'host' as const }] : []),
      { kind: 'up' as const },
      ...sorted.map((entry) => ({ kind: 'entry' as const, entry })),
    ];

    const lines = [
      ...compactHeader(fieldJoin('FILES', pathDisplay)),
      ...buildScrollableList({
        items: allItems,
        highlightedIndex: nav.highlightedIndex,
        maxVisible: 8,
        formatter: (item) => {
          if (item.kind === 'host') {
            return `${fieldJoin('HOST', truncate(hostLabel, 20))} ${DRILL}`;
          }
          if (item.kind === 'up') return '..';
          const entry = item.entry;
          if (entry.type === 'dir') return drillLabel(entry.name + '/');
          const sizeStr = formatSize(entry.size);
          const name = truncate(entry.name, 32);
          return `${name} ${SEP} ${sizeStr}`;
        },
      }),
    ];

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    const sorted = getSortedEntries(snap);
    const hasHostPicker = snap.hosts.length > 1;
    const totalItems = sorted.length + 1 + (hasHostPicker ? 1 : 0);
    const upIndex = hasHostPicker ? 1 : 0;
    const firstEntryIndex = hasHostPicker ? 2 : 1;

    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = Math.max(0, totalItems - 1);
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      const hostParam = snap.selectedHostId ? `&host=${encodeURIComponent(snap.selectedHostId)}` : '';
      if (hasHostPicker && nav.highlightedIndex === 0) {
        const currentIndex = Math.max(0, snap.hosts.findIndex((host) => host.id === snap.selectedHostId));
        const nextHost = snap.hosts[(currentIndex + 1) % snap.hosts.length];
        if (nextHost) {
          ctx.navigate(`/files?path=${encodeURIComponent('~')}&host=${encodeURIComponent(nextHost.id)}`);
        }
        return { ...nav, highlightedIndex: 0 };
      }
      if (nav.highlightedIndex === upIndex) {
        const parentPath = snap.browserPath === '~' ? '~' : snap.browserPath.replace(/\/[^/]+$/, '') || '~';
        if (parentPath === snap.browserPath) {
          ctx.navigate('/');
          return { ...nav, highlightedIndex: 0 };
        }
        ctx.navigate(`/files?path=${encodeURIComponent(parentPath)}${hostParam}`);
        return { ...nav, highlightedIndex: 0 };
      }
      const entry = sorted[nav.highlightedIndex - firstEntryIndex];
      if (entry) {
        const newPath = snap.browserPath === '~' ? `~/${entry.name}` : `${snap.browserPath}/${entry.name}`;
        if (entry.type === 'dir') {
          ctx.navigate(`/files?path=${encodeURIComponent(newPath)}${hostParam}`);
        } else {
          ctx.navigate(`/file-view?path=${encodeURIComponent(newPath)}${hostParam}`);
        }
        return { ...nav, highlightedIndex: 0 };
      }
      return nav;
    }
    if (action.type === 'GO_BACK') {
      const parentPath = snap.browserPath === '~' ? null : snap.browserPath.replace(/\/[^/]+$/, '') || '~';
      const hostParam = snap.selectedHostId ? `&host=${encodeURIComponent(snap.selectedHostId)}` : '';
      if (!parentPath || parentPath === snap.browserPath) {
        ctx.navigate('/');
        return { ...nav, highlightedIndex: 0 };
      }
      ctx.navigate(`/files?path=${encodeURIComponent(parentPath)}${hostParam}`);
      return { ...nav, highlightedIndex: 0 };
    }
    return nav;
  },
};
