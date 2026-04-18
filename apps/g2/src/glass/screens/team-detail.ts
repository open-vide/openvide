/**
 * Team detail screen with page navigation.
 *
 * Default: Tasks page with ▶Tasks◀ button. Tap → scroll through Tasks/Plan/Chat.
 * Chat page shows Chat / Input / Read in the header action bar.
 */
import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { truncate, applyScrollIndicators } from 'even-toolkit/text-utils';
import { buildActionBar, buildStaticActionBar } from 'even-toolkit/action-bar';
import { createModeEncoder } from 'even-toolkit/glass-mode';
import { moveHighlight, clampIndex } from 'even-toolkit/glass-nav';
import { fieldJoin, SEP } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';

// taskScroll at 0 = default mode on screen entry (highlightedIndex starts at 0)
const m = createModeEncoder({
  taskScroll: 0,
  pageSelect: 100,  // scrolling through page names
  chatButtons: 200, // chat: scrolling Chat/Input/Read in action bar
  chatRead: 300,    // chat: scrolling messages
  planView: 400,    // plan content
});

const PAGES = ['Tasks', 'Plan', 'Chat'];
const CHAT_BUTTONS = ['Chat', 'Input', 'Read'];

export const teamDetailScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const team = snap.teams.find(t => t.id === snap.selectedTeamId);
    const teamName = truncate(team?.name ?? 'Team', 16).toUpperCase();
    const mode = m.getMode(nav.highlightedIndex);
    const offset = m.getOffset(nav.highlightedIndex);
    const tasks = snap.teamTasks;
    const msgs = snap.teamMessages;

    // Determine current page label
    let pageLabel = 'Tasks';
    if (mode === 'chatButtons' || mode === 'chatRead') pageLabel = 'Chat';
    else if (mode === 'planView') pageLabel = 'Plan';
    else if (mode === 'pageSelect') pageLabel = PAGES[clampIndex(offset, PAGES.length)];

    // Action bar
    let actionBar: string;
    if (mode === 'pageSelect') {
      const idx = clampIndex(offset, PAGES.length);
      if (idx === 2) {
        actionBar = buildStaticActionBar(CHAT_BUTTONS, 0);
      } else {
        actionBar = buildActionBar([pageLabel], 0, null);
      }
    } else if (mode === 'chatButtons') {
      const btnIdx = clampIndex(offset, CHAT_BUTTONS.length);
      actionBar = buildStaticActionBar(CHAT_BUTTONS, btnIdx);
    } else if (mode === 'chatRead') {
      actionBar = buildStaticActionBar(CHAT_BUTTONS, 2);
    } else {
      actionBar = buildActionBar([pageLabel], 0, pageLabel);
    }

    const headerLines = compactHeader(teamName, actionBar);
    const contentSlots = 8;

    // === TASKS ===
    if (mode === 'taskScroll') {
      if (tasks.length === 0) {
        return { lines: [...headerLines, line('No tasks', 'meta')] };
      }
      const taskLines = tasks.map(task => {
        const st = task.status === 'TODO' ? 'TODO' : task.status === 'IN PROGRESS' ? 'PROG' : task.status === 'DONE' ? 'DONE' : task.status.slice(0, 4).toUpperCase();
        const owner = task.owner ? ` @${truncate(task.owner, 8)}` : '';
        return `${st} ${SEP} ${truncate(task.subject, 38 - owner.length)}${owner}`;
      });
      const start = Math.max(0, Math.min(offset, taskLines.length - contentSlots));
      const visible = taskLines.slice(start, start + contentSlots);
      const dl = visible.map((t, i) => line(t, 'normal', i + start === offset));
      applyScrollIndicators(dl, start, taskLines.length, contentSlots, t => line(t, 'meta'));
      return { lines: [...headerLines, ...dl] };
    }

    // === PAGE SELECT (preview) ===
    if (mode === 'pageSelect') {
      const idx = clampIndex(offset, PAGES.length);
      let preview = '';
      if (idx === 0) preview = `${tasks.length} tasks`;
      else if (idx === 1) preview = snap.teamPlan ? `${snap.teamPlan.status} · ${snap.teamPlan.iteration}/${snap.teamPlan.maxIterations}` : 'No plans';
      else preview = `${msgs.length} messages`;
      return { lines: [...headerLines, line(preview, 'meta')] };
    }

    // === CHAT BUTTONS (action bar navigation) ===
    // Keep content minimal (single line) so the glass framework does NOT
    // intercept HIGHLIGHT_MOVE for content scrolling — letting the action
    // handler cycle through Chat / Read / Input in the header bar instead.
    if (mode === 'chatButtons') {
      const lastMsg = msgs.length > 0
        ? `${truncate(msgs[msgs.length - 1].from, 8)}: ${truncate(msgs[msgs.length - 1].text, 40)}`
        : 'No messages';
      return {
        lines: [
          ...headerLines,
          line(`${msgs.length} message${msgs.length !== 1 ? 's' : ''}`, 'meta'),
          line(lastMsg, 'meta'),
        ],
      };
    }

    // === CHAT READ ===
    if (mode === 'chatRead') {
      if (msgs.length === 0) {
        return { lines: [...headerLines, line('No messages', 'meta')] };
      }
      const msgLines = msgs.map(msg => `${truncate(msg.from, 10)} ${SEP} ${truncate(msg.text, 44)}`);
      const maxBot = Math.max(0, msgLines.length - contentSlots);
      const cOff = Math.min(offset, maxBot);
      const start = Math.max(0, msgLines.length - contentSlots - cOff);
      const visible = msgLines.slice(start, start + contentSlots);
      const dl = visible.map(t => line(t, 'normal'));
      applyScrollIndicators(dl, start, msgLines.length, contentSlots, t => line(t, 'meta'));
      return { lines: [...headerLines, ...dl] };
    }

    // === PLAN ===
    if (mode === 'planView') {
      const plan = snap.teamPlan;
      if (!plan) {
        return { lines: [...headerLines, line('No plans', 'meta')] };
      }

      const latestRevision = plan.revisions[plan.revisions.length - 1];
      const planLines = [
        fieldJoin(plan.status.toUpperCase(), `${plan.iteration}/${plan.maxIterations}`),
        fieldJoin(plan.mode.toUpperCase(), `${latestRevision?.tasks.length ?? 0} TASKS`),
        ...(latestRevision?.tasks.slice(0, 5).map((task, index) =>
          `${index + 1}. ${truncate(task.subject, 28)} ${SEP} @${truncate(task.owner, 8)}`) ?? []),
      ];
      return { lines: [...headerLines, ...planLines.map((text) => line(text, 'normal'))] };
    }

    return { lines: headerLines };
  },

  action: (action, nav, snap, ctx) => {
    const mode = m.getMode(nav.highlightedIndex);
    const offset = m.getOffset(nav.highlightedIndex);

    // TASKS: scroll list. Tap → page select. Back → teams list.
    if (mode === 'taskScroll') {
      if (action.type === 'HIGHLIGHT_MOVE') {
        const max = Math.max(0, snap.teamTasks.length - 1);
        return { ...nav, highlightedIndex: m.encode('taskScroll', moveHighlight(offset, action.direction, max)) };
      }
      if (action.type === 'SELECT_HIGHLIGHTED') {
        return { ...nav, highlightedIndex: m.encode('pageSelect', 0) }; // start at Tasks
      }
      if (action.type === 'GO_BACK') {
        ctx.navigate('/teams');
        return { ...nav, highlightedIndex: 0 };
      }
      return nav;
    }

    // PAGE SELECT: scroll cycles page name. Tap → enter that page. Back → tasks.
    if (mode === 'pageSelect') {
      if (action.type === 'HIGHLIGHT_MOVE') {
        return { ...nav, highlightedIndex: m.encode('pageSelect', moveHighlight(offset, action.direction, PAGES.length - 1)) };
      }
      if (action.type === 'SELECT_HIGHLIGHTED') {
        const idx = clampIndex(offset, PAGES.length);
        if (idx === 0) return { ...nav, highlightedIndex: m.encode('taskScroll', 0) };
        if (idx === 1) return { ...nav, highlightedIndex: m.encode('planView', 0) };
        if (idx === 2) return { ...nav, highlightedIndex: m.encode('chatButtons', 0) };
        return nav;
      }
      if (action.type === 'GO_BACK') {
        return { ...nav, highlightedIndex: m.encode('taskScroll', 0) };
      }
      return nav;
    }

    // CHAT BUTTONS: scroll Chat/Input/Read in action bar. Tap → enter action. Back → page select.
    if (mode === 'chatButtons') {
      if (action.type === 'HIGHLIGHT_MOVE') {
        // offset 0=Chat, 1=Input, 2=Read
        return { ...nav, highlightedIndex: m.encode('chatButtons', moveHighlight(offset, action.direction, CHAT_BUTTONS.length - 1)) };
      }
      if (action.type === 'SELECT_HIGHLIGHTED') {
        if (offset === 0) return { ...nav, highlightedIndex: m.encode('pageSelect', 2) };
        if (offset === 1) { ctx.startVoice(); return nav; }                                 // Input
        if (offset === 2) return { ...nav, highlightedIndex: m.encode('chatRead', 0) };   // Read
        return nav;
      }
      if (action.type === 'GO_BACK') {
        return { ...nav, highlightedIndex: m.encode('pageSelect', 2) };
      }
      return nav;
    }

    // CHAT READ: scroll messages. Tap/back → chat buttons at Read.
    if (mode === 'chatRead') {
      if (action.type === 'HIGHLIGHT_MOVE') {
        const max = Math.max(0, snap.teamMessages.length - 8);
        return { ...nav, highlightedIndex: m.encode('chatRead', moveHighlight(offset, action.direction, max)) };
      }
      if (action.type === 'SELECT_HIGHLIGHTED' || action.type === 'GO_BACK') {
        return { ...nav, highlightedIndex: m.encode('chatButtons', 2) }; // back to Read
      }
      return nav;
    }

    // PLAN: tap → page select at Plan. Back → page select at Plan.
    if (mode === 'planView') {
      if (action.type === 'SELECT_HIGHLIGHTED' || action.type === 'GO_BACK') {
        return { ...nav, highlightedIndex: m.encode('pageSelect', 1) };
      }
      return nav;
    }

    return nav;
  },
};
