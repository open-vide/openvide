import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line, separator } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { truncate } from 'even-toolkit/text-utils';
import { fieldJoin } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

export const schedulesScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const count = snap.scheduledTasks.length;
    const lines = [
      ...compactHeader(fieldJoin('SCHEDULES', `${count}`)),
    ];

    if (count === 0) {
      lines.push(line('No scheduled tasks', 'meta'));
      return { lines };
    }

    lines.push(
      ...buildScrollableList({
        items: snap.scheduledTasks,
        highlightedIndex: nav.highlightedIndex,
        maxVisible: 8,
        formatter: (task) => {
          const status = task.lastStatus === 'running'
            ? 'RUN'
            : task.lastStatus === 'failed'
              ? 'ERR'
              : task.enabled
                ? 'ON'
                : 'OFF';
          return fieldJoin(truncate(task.name, 14), truncate(status, 3), truncate(task.schedule, 10));
        },
      }),
    );

    return { lines };
  },

  action: (action, nav, snap, ctx) => {
    if (action.type === 'HIGHLIGHT_MOVE') {
      const max = Math.max(0, snap.scheduledTasks.length - 1);
      const idx = action.direction === 'down'
        ? Math.min(nav.highlightedIndex + 1, max)
        : Math.max(nav.highlightedIndex - 1, 0);
      return { ...nav, highlightedIndex: idx };
    }
    if (action.type === 'GO_BACK') {
      ctx.navigate('/');
      return { ...nav, highlightedIndex: 0 };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      const task = snap.scheduledTasks[nav.highlightedIndex];
      if (!task) return nav;
      void ctx.rpc('schedule.run', { taskId: task.id });
      return nav;
    }
    return nav;
  },
};
