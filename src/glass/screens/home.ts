import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { fieldJoin, drillLabel, SEP } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

const MENU_KEYS = ['workspaces', 'sessions', 'teams', 'hosts', 'schedules', 'files', 'settings'] as const;
const MENU_PATHS: Record<string, string> = {
  workspaces: '/workspace',
  sessions: '/sessions',
  teams: '/teams',
  hosts: '/hosts',
  files: '/files',
  schedules: '/schedules',
  settings: '/settings',
};

export const homeScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const total = snap.sessions.length;
    const running = snap.sessions.filter(s => s.status === 'running').length;
    const idle = snap.sessions.filter(s => s.status === 'idle').length;
    const connected = snap.selectedHostId
      ? snap.hostStatuses[snap.selectedHostId] === 'connected'
      : snap.hosts.some((host) => snap.hostStatuses[host.id] === 'connected');

    const counters = fieldJoin(
      `${total} Sessions`,
      `${running} Running`,
      connected ? 'on' : 'off',
    );

    const wsCount = snap.workspaces.length;
    const wsRunning = snap.workspaces.reduce((a, w) => a + w.runningCount, 0);
    const hostCount = snap.hosts.length;
    const hostsOn = snap.hosts.filter(h => snap.hostStatuses[h.id] === 'connected').length;
    const teamCount = snap.teams.length;
    const teamActive = snap.teams.reduce((a, t) => a + (t.activeCount ?? 0), 0);
    const schedCount = snap.scheduledTasks.length;

    const menuItems = [
      { key: 'workspaces', info: fieldJoin('Workspaces', `${wsCount}`, wsRunning > 0 ? `${wsRunning} run` : undefined) },
      { key: 'sessions', info: fieldJoin('Sessions', `${total}`, `${running} run`, `${idle} idle`) },
      { key: 'teams', info: fieldJoin('Teams', `${teamCount}`, teamActive > 0 ? `${teamActive} active` : undefined) },
      { key: 'hosts', info: fieldJoin('Hosts', `${hostsOn}/${hostCount} on`) },
      { key: 'schedules', info: fieldJoin('Schedules', schedCount > 0 ? `${schedCount}` : '0') },
      { key: 'files', info: 'Files' },
      { key: 'settings', info: 'Settings' },
    ];

    const lines = [
      ...compactHeader(counters),
      ...buildScrollableList({
        items: menuItems,
        highlightedIndex: nav.highlightedIndex,
        maxVisible: 8,
        formatter: (item) => drillLabel(item.info),
      }),
    ];

    return { lines };
  },

  action: (action, nav, _snap, ctx) => {
    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = MENU_KEYS.length - 1;
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      const key = MENU_KEYS[nav.highlightedIndex];
      const path = key === 'files'
        ? `/files?path=${encodeURIComponent('~')}${_snap.selectedHostId ? `&host=${encodeURIComponent(_snap.selectedHostId)}` : ''}`
        : MENU_PATHS[key];
      if (path) ctx.navigate(path);
      return { ...nav, highlightedIndex: 0 };
    }
    return nav;
  },
};
