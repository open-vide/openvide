import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { truncate } from 'even-toolkit/text-utils';

import { fieldJoin, drillLabel, SEP } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

export const teamListScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const count = snap.teams.length;
    const totalMembers = snap.teams.reduce((a, t: any) => a + (t.memberCount ?? t.members?.length ?? 0), 0);
    const lines = [...compactHeader(fieldJoin('TEAMS', `${count}`, totalMembers > 0 ? `${totalMembers} members` : undefined))];

    if (count === 0) {
      lines.push(line('No teams', 'meta'));
      return { lines };
    }

    lines.push(...buildScrollableList({
      items: snap.teams,
      highlightedIndex: nav.highlightedIndex,
      maxVisible: 8,
      formatter: (team: any) => {
        const members = team.memberCount ?? team.members?.length ?? 0;
        const tasks = team.taskCount ?? 0;
        const parts = [truncate(team.name, 24)];
        if (members > 0) parts.push(`${members} members`);
        if (tasks > 0) parts.push(`${tasks} tasks`);
        return drillLabel(fieldJoin(...parts));
      },
    }));

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = Math.max(0, snap.teams.length - 1);
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      const team = snap.teams[nav.highlightedIndex];
      if (team) {
        ctx.navigate(`/team?id=${team.id}`);
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
