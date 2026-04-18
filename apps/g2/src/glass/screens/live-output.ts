/**
 * Live output (chat) screen — the most important screen.
 *
 * Modes:
 *   - buttons: swipe between header buttons (Input, Read, Mode)
 *   - read: navigate logical blocks with cursor, tap to expand/collapse
 *
 * In default view (buttons mode): auto-scrolled to bottom, all blocks collapsed.
 * In read mode: ▶ cursor on current block, up/down moves between blocks,
 *   tap expands/collapses the current block (thinking, tool calls, etc).
 */
import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { line, separator } from 'even-toolkit/types';
import { compactHeader } from '../header';
import { truncate, applyScrollIndicators } from 'even-toolkit/text-utils';
import { buildActionBar } from 'even-toolkit/action-bar';
import { createModeEncoder } from 'even-toolkit/glass-mode';
import { moveHighlight, clampIndex } from 'even-toolkit/glass-nav';
import { fieldJoin, SEP } from 'even-toolkit/glass-format';
import type { OpenVideSnapshot, OpenVideActions } from '../types';
import { resolveGlassSessionMeta } from '../session-meta';
import {
  isThinkingHeader, isThinkingBody,
  parseThinkingHeader, parseThinkingBody,
  THINK_HEADER,
} from '../../domain/output-parser';

const chatMode = createModeEncoder({
  buttons: 0,
  read: 100,        // read collapsed: offset = block index
  readOpen: 200,    // read expanded: offset = block index (current block is open)
  modeSelect: 300,
  modelSelect: 400,
});

const MODE_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'code', label: 'Code' },
  { id: 'plan', label: 'Plan' },
  { id: 'chat', label: 'Chat' },
];
const CLAUDE_MODEL_OPTIONS = [
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
];
const THINKING_VERBS = [
  'Thinking', 'Reasoning', 'Pondering', 'Considering', 'Analyzing',
  'Processing', 'Evaluating', 'Reflecting', 'Examining', 'Working',
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getThinkingVerb(): string {
  const idx = Math.floor(Date.now() / 3000) % THINKING_VERBS.length;
  return THINKING_VERBS[idx] ?? 'Processing';
}

function getModelOptions(tool?: string, currentModel?: string): Array<{ id: string; label: string }> {
  if (tool === 'claude') return CLAUDE_MODEL_OPTIONS;
  if (currentModel?.trim()) return [{ id: currentModel, label: currentModel }];
  return [{ id: 'default', label: 'Default' }];
}

function getModeLabel(mode: string): string {
  return MODE_OPTIONS.find((item) => item.id === mode)?.label ?? cap(mode || 'auto');
}

function getModelLabel(tool: string | undefined, model: string): string {
  const options = getModelOptions(tool, model);
  return options.find((item) => item.id === model)?.label ?? model ?? 'Default';
}

function getChatButtons(currentMode: string, currentModelLabel: string): string[] {
  return ['Input', 'Read', currentMode, currentModelLabel];
}

function getActionBarState(
  mode: ReturnType<typeof chatMode.getMode>,
  highlightedIndex: number,
  buttons: string[],
): { selectedIndex: number; activeLabel: string | null } {
  if (mode === 'read' || mode === 'readOpen') {
    return { selectedIndex: 1, activeLabel: buttons[1] ?? null };
  }
  if (mode === 'modeSelect') {
    return { selectedIndex: 2, activeLabel: buttons[2] ?? null };
  }
  if (mode === 'modelSelect') {
    return { selectedIndex: 3, activeLabel: buttons[3] ?? null };
  }
  return {
    selectedIndex: clampIndex(highlightedIndex, buttons.length),
    activeLabel: null,
  };
}

function isReadNavIndex(highlightedIndex: number | null | undefined): highlightedIndex is number {
  if (typeof highlightedIndex !== 'number' || !Number.isFinite(highlightedIndex)) return false;
  const mode = chatMode.getMode(highlightedIndex);
  return mode === 'read' || mode === 'readOpen';
}

/** A logical block in the chat — each block is one navigable item. */
interface ChatBlock {
  kind: 'prompt' | 'text' | 'tool' | 'thinking' | 'error';
  /** Short display text (1 line, shown when collapsed) */
  summary: string;
  /** Expanded content lines (shown when block is expanded) */
  detail: string[];
  /** For thinking blocks: the thinking ID for expand/collapse tracking */
  thinkingId?: number;
}

/**
 * Build logical blocks from raw output lines.
 * Each block represents one navigable/collapsible item.
 */
function buildBlocks(outputLines: string[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let textAccum: string[] = [];

  const flushText = () => {
    if (textAccum.length === 0) return;
    const summary = textAccum[0];
    blocks.push({
      kind: 'text',
      summary: truncate(summary, 60),
      detail: textAccum,
    });
    textAccum = [];
  };

  for (const text of outputLines) {
    // Thinking header
    if (isThinkingHeader(text)) {
      flushText();
      const parsed = parseThinkingHeader(text);
      if (parsed) {
        blocks.push({
          kind: 'thinking',
          summary: 'Thinking',
          detail: [parsed.summary],
          thinkingId: parsed.id,
        });
      }
      continue;
    }

    // Thinking body — attach to last thinking block
    if (isThinkingBody(text)) {
      const parsed = parseThinkingBody(text);
      if (parsed) {
        const last = blocks[blocks.length - 1];
        if (last?.kind === 'thinking' && last.thinkingId === parsed.id) {
          last.detail.push(parsed.text);
        }
      }
      continue;
    }

    // User prompt
    if (text.startsWith('\u00A7P\u00A7')) {
      flushText();
      const prompt = text.slice(3);
      blocks.push({
        kind: 'prompt',
        summary: truncate(prompt, 60),
        detail: [prompt],
      });
      continue;
    }

    // Tool call
    if (text.startsWith('>> ')) {
      flushText();
      const toolText = text.slice(3);
      blocks.push({
        kind: 'tool',
        summary: truncate(toolText, 58),
        detail: [toolText],
      });
      continue;
    }

    // Error
    if (text.startsWith('! ')) {
      flushText();
      blocks.push({
        kind: 'error',
        summary: truncate(text.slice(2), 58),
        detail: [text.slice(2)],
      });
      continue;
    }

    // Regular text — accumulate into current text block
    if (text.trim()) {
      textAccum.push(text);
    } else if (textAccum.length > 0) {
      // Empty line = paragraph break
      flushText();
    }
  }

  flushText();
  return blocks;
}

interface RenderLine {
  text: string;
  isCursorLine: boolean;
}

/**
 * Build all display lines from blocks.
 * Returns flat array with block ownership tracking.
 */
function buildAllLines(
  blocks: ChatBlock[],
  expandedBlockIdx: number,
): { blockIdx: number; text: string }[] {
  const allLines: { blockIdx: number; text: string }[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const alwaysExpand = block.kind === 'text' || block.kind === 'prompt' || block.kind === 'error';
    const isExpanded = alwaysExpand || (i === expandedBlockIdx);

    let prefix = '';
    switch (block.kind) {
      case 'prompt': prefix = '> '; break;
      case 'tool': prefix = '>> '; break;
      case 'thinking': prefix = '* '; break;
      case 'error': prefix = '! '; break;
      default: prefix = ''; break;
    }

    // Blank line before prompts for readability
    if (block.kind === 'prompt' && allLines.length > 0) {
      allLines.push({ blockIdx: -1, text: '' });
    }

    if (!isExpanded) {
      allLines.push({ blockIdx: i, text: `${prefix}${block.summary}` });
    } else {
      for (let j = 0; j < block.detail.length; j++) {
        const pfx = j === 0 ? prefix : '  ';
        const wrapped = wrapLine(`${pfx}${block.detail[j]}`, 62);
        for (const wl of wrapped) {
          allLines.push({ blockIdx: i, text: wl });
        }
      }
    }

    // Separator after prompts
    if (block.kind === 'prompt') {
      allLines.push({ blockIdx: -1, text: '__SEP__' });
    }
  }

  return allLines;
}

/**
 * Render for display with line-based scrolling.
 * In auto-scroll (non-read): show last N lines.
 * In read mode: cursor is on a specific line, window centers on it.
 */
function renderBlocksLineMode(
  blocks: ChatBlock[],
  cursorLineIdx: number,
  expandedBlockIdx: number,
  isReadMode: boolean,
  maxLines: number,
): RenderLine[] {
  const allLines = buildAllLines(blocks, expandedBlockIdx);

  if (!isReadMode) {
    const start = Math.max(0, allLines.length - maxLines);
    return allLines.slice(start, start + maxLines).map(l => ({
      text: l.text,
      isCursorLine: false,
    }));
  }

  // Clamp cursor to valid range
  const clampedCursor = Math.max(0, Math.min(cursorLineIdx, allLines.length - 1));

  // Window: keep cursor visible, prefer showing it near the middle
  const halfWindow = Math.floor(maxLines / 2);
  let start = Math.max(0, clampedCursor - halfWindow);
  if (start + maxLines > allLines.length) {
    start = Math.max(0, allLines.length - maxLines);
  }

  return allLines.slice(start, start + maxLines).map((l, i) => ({
    text: l.text,
    isCursorLine: (start + i) === clampedCursor,
  }));
}

/** Get the block index that owns a given line index. */
function getBlockAtLine(blocks: ChatBlock[], expandedBlockIdx: number, lineIdx: number): number {
  const allLines = buildAllLines(blocks, expandedBlockIdx);
  const clamped = Math.max(0, Math.min(lineIdx, allLines.length - 1));
  return allLines[clamped]?.blockIdx ?? -1;
}

function wrapLine(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      break;
    }
    let breakAt = remaining.lastIndexOf(' ', maxChars);
    if (breakAt <= 0) breakAt = maxChars;
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  return lines;
}

function isEffectiveHostConnected(snap: OpenVideSnapshot, hostId?: string | null): boolean {
  const effectiveHostId = hostId ?? snap.selectedWorkspaceHostId ?? snap.selectedHostId ?? null;
  if (!effectiveHostId) {
    return snap.hosts.some((host) => snap.hostStatuses[host.id] === 'connected');
  }
  return snap.hostStatuses[effectiveHostId] === 'connected';
}

export const liveOutputScreen: GlassScreen<OpenVideSnapshot, OpenVideActions> = {
  display: (snap, nav) => {
    const sessionMeta = resolveGlassSessionMeta(snap);
    const selectedSession = snap.selectedSessionId
      ? snap.sessions.find((session) => session.id === snap.selectedSessionId) ?? null
      : null;
    const tool = sessionMeta.tool?.toUpperCase() ?? 'AI';
    const model = sessionMeta.model ? truncate(sessionMeta.model, 10) : '';
    const status = sessionMeta.status;
    const contextPct = snap.outputLines.length > 0 ? Math.min(Math.round((snap.outputLines.length / 200) * 100), 99) : 0;
    // Detect pending reply (session idle but last output ends with ?)
    const lastLine = snap.outputLines[snap.outputLines.length - 1]?.trim() ?? '';
    const isPending = status === 'idle' && snap.outputLines.length > 0 && lastLine.endsWith('?');
    const statusLabel = status === 'running' ? 'run' : isPending ? 'pending' : undefined;
    const title = fieldJoin(tool, statusLabel, contextPct > 0 ? `${contextPct}%` : undefined);

    const mode = chatMode.getMode(nav.highlightedIndex);
    const currentSessionMode = snap.selectedSessionMode || 'auto';
    const currentSessionModel = snap.selectedSessionModel || sessionMeta.model || (sessionMeta.tool === 'claude' ? 'opus' : '');
    const modelOptions = getModelOptions(sessionMeta.tool, currentSessionModel);

    // In mode/model select: scroll changes the displayed value inline
    const currentMode = mode === 'modeSelect'
      ? (MODE_OPTIONS[clampIndex(chatMode.getOffset(nav.highlightedIndex), MODE_OPTIONS.length)]?.id ?? currentSessionMode)
      : currentSessionMode;
    const currentModel = mode === 'modelSelect'
      ? (modelOptions[clampIndex(chatMode.getOffset(nav.highlightedIndex), modelOptions.length)]?.id ?? currentSessionModel)
      : currentSessionModel;
    const buttons = getChatButtons(getModeLabel(currentMode), getModelLabel(sessionMeta.tool, currentModel));

    const { selectedIndex, activeLabel } = getActionBarState(mode, nav.highlightedIndex, buttons);
    const actionBar = buildActionBar(buttons, selectedIndex, activeLabel);

    const blocks = buildBlocks(snap.outputLines);
    const lastBlock = blocks[blocks.length - 1];
    // Show the thinking indicator whenever the last block is a user prompt
    // and no assistant content has arrived yet. Tool-agnostic — Claude streams
    // while `status === 'running'`, but Codex/Gemini often respond in one shot
    // (and external CLI writes keep `status === 'idle'` entirely), so relying
    // only on `status === 'running'` would miss those cases.
    const showProcessing = !!lastBlock && lastBlock.kind === 'prompt';
    const selectedHostConnected = isEffectiveHostConnected(snap, selectedSession?.hostId);
    const showOfflineWarning = !selectedHostConnected;
    // One row reserved vs. raw grid so the last line isn't clipped by the glass display.
    const contentSlots = showProcessing ? 5 : 6;

    if (blocks.length === 0) {
      return {
        lines: [
          ...compactHeader(title, actionBar, showOfflineWarning ? '! offline' : undefined),
          line(showProcessing ? `* ${getThinkingVerb()}...` : '  Waiting for input...', 'meta'),
        ],
      };
    }

    const isReadMode = mode === 'read' || mode === 'readOpen';
    const readLineIdx = isReadMode ? chatMode.getOffset(nav.highlightedIndex) : -1;
    // In readOpen, find which block owns the current line and expand it
    const expandedBlockIdx = mode === 'readOpen' ? getBlockAtLine(blocks, -1, readLineIdx) : -1;

    const rendered = renderBlocksLineMode(blocks, readLineIdx, expandedBlockIdx, isReadMode, contentSlots);

    const headerLines = compactHeader(title, actionBar, showOfflineWarning ? '! offline' : undefined);
    const contentLines = [
      ...rendered.map(r => {
        if (r.text === '__SEP__') return separator();
        return line(r.text, 'normal', r.isCursorLine);
      }),
    ];

    if (showProcessing) {
      contentLines.push(line(''));
      contentLines.push(line(`* ${getThinkingVerb()}...`, 'meta'));
    }

    return { lines: [...headerLines, ...contentLines] };
  },

  action: (action, nav, snap, ctx) => {
    const mode = chatMode.getMode(nav.highlightedIndex);
    const blocks = buildBlocks(snap.outputLines);
    const sessionMeta = resolveGlassSessionMeta(snap);
    const currentMode = snap.selectedSessionMode || 'auto';
    const currentModel = snap.selectedSessionModel || sessionMeta.model || (sessionMeta.tool === 'claude' ? 'opus' : '');
    const modelOptions = getModelOptions(sessionMeta.tool, currentModel);
    const buttons = getChatButtons(getModeLabel(currentMode), getModelLabel(sessionMeta.tool, currentModel));

    if (mode === 'buttons') {
      if (action.type === 'HIGHLIGHT_MOVE') {
        const btnIdx = clampIndex(nav.highlightedIndex, buttons.length);
        return { ...nav, highlightedIndex: moveHighlight(btnIdx, action.direction, buttons.length - 1) };
      }
      if (action.type === 'SELECT_HIGHLIGHTED') {
        const btnIdx = clampIndex(nav.highlightedIndex, buttons.length);
        if (btnIdx === 0) {
          if (snap.selectedSessionId && (snap.suggestedPrompts.length > 0 || snap.prompts.length > 0)) {
            ctx.navigate(`/prompt-select?session=${encodeURIComponent(snap.selectedSessionId)}`);
          } else {
            ctx.startVoice();
          }
          return nav;
        }
        if (btnIdx === 1) {
          const storedReadIndex = isReadNavIndex(snap.selectedSessionReadNavIndex)
            ? snap.selectedSessionReadNavIndex
            : null;
          if (storedReadIndex != null) {
            return { ...nav, highlightedIndex: storedReadIndex };
          }

          // Read: enter read mode at last block
          const allLines = buildAllLines(blocks, -1);
          const lastLine = Math.max(0, allLines.length - 1);
          const nextHighlightedIndex = chatMode.encode('read', lastLine);
          ctx.setSessionReadNavIndex(nextHighlightedIndex);
          return { ...nav, highlightedIndex: nextHighlightedIndex };
        }
        if (btnIdx === 2) {
          // Mode: enter mode selection (scroll through modes)
          return { ...nav, highlightedIndex: chatMode.encode('modeSelect', 0) };
        }
        if (btnIdx === 3) {
          // Model: enter model selection (scroll through models)
          return { ...nav, highlightedIndex: chatMode.encode('modelSelect', 0) };
        }
        return nav;
      }
      if (action.type === 'GO_BACK') {
        ctx.navigate('/sessions');
        return { ...nav, highlightedIndex: 0 };
      }
      return nav;
    }

    if (mode === 'read' || mode === 'readOpen') {
      const lineIdx = chatMode.getOffset(nav.highlightedIndex);
      // Build lines to know total count (with current expand state)
      const expandedBlock = mode === 'readOpen' ? getBlockAtLine(blocks, -1, lineIdx) : -1;
      const allLines = buildAllLines(blocks, expandedBlock);
      const maxLine = Math.max(0, allLines.length - 1);

      if (action.type === 'HIGHLIGHT_MOVE') {
        // Line-by-line scrolling — keep current expand state
        const newLine = moveHighlight(lineIdx, action.direction, maxLine);
        const nextHighlightedIndex = chatMode.encode(mode as any, newLine);
        ctx.setSessionReadNavIndex(nextHighlightedIndex);
        return { ...nav, highlightedIndex: nextHighlightedIndex };
      }
      if (action.type === 'SELECT_HIGHLIGHTED') {
        // Tap toggles expand/collapse of the block at current line
        const blockIdx = allLines[Math.min(lineIdx, maxLine)]?.blockIdx ?? -1;
        const block = blockIdx >= 0 ? blocks[blockIdx] : undefined;
        // Only toggle collapsible blocks (thinking, tool)
        if (block && (block.kind === 'thinking' || block.kind === 'tool')) {
          if (mode === 'read') {
            const nextHighlightedIndex = chatMode.encode('readOpen', lineIdx);
            ctx.setSessionReadNavIndex(nextHighlightedIndex);
            return { ...nav, highlightedIndex: nextHighlightedIndex };
          } else {
            const nextHighlightedIndex = chatMode.encode('read', lineIdx);
            ctx.setSessionReadNavIndex(nextHighlightedIndex);
            return { ...nav, highlightedIndex: nextHighlightedIndex };
          }
        }
        return nav;
      }
      if (action.type === 'GO_BACK') {
        if (mode === 'readOpen') {
          const nextHighlightedIndex = chatMode.encode('read', lineIdx);
          ctx.setSessionReadNavIndex(nextHighlightedIndex);
          return { ...nav, highlightedIndex: nextHighlightedIndex };
        }
        ctx.setSessionReadNavIndex(nav.highlightedIndex);
        return { ...nav, highlightedIndex: 0 };
      }
      return nav;
    }

    if (mode === 'modeSelect') {
      const offset = chatMode.getOffset(nav.highlightedIndex);
      if (action.type === 'HIGHLIGHT_MOVE') {
        return { ...nav, highlightedIndex: chatMode.encode('modeSelect', moveHighlight(offset, action.direction, MODE_OPTIONS.length - 1)) };
      }
      if (action.type === 'SELECT_HIGHLIGHTED') {
        ctx.setSessionMode(MODE_OPTIONS[clampIndex(offset, MODE_OPTIONS.length)]?.id ?? 'auto');
        return { ...nav, highlightedIndex: 2 }; // back to mode button
      }
      if (action.type === 'GO_BACK') {
        return { ...nav, highlightedIndex: 2 };
      }
      return nav;
    }

    if (mode === 'modelSelect') {
      const offset = chatMode.getOffset(nav.highlightedIndex);
      if (action.type === 'HIGHLIGHT_MOVE') {
        return { ...nav, highlightedIndex: chatMode.encode('modelSelect', moveHighlight(offset, action.direction, modelOptions.length - 1)) };
      }
      if (action.type === 'SELECT_HIGHLIGHTED') {
        ctx.setSessionModel(modelOptions[clampIndex(offset, modelOptions.length)]?.id ?? currentModel);
        return { ...nav, highlightedIndex: 3 }; // back to model button
      }
      if (action.type === 'GO_BACK') {
        return { ...nav, highlightedIndex: 3 };
      }
      return nav;
    }

    return nav;
  },
};
