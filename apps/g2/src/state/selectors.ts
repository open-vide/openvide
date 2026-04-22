import type { AppState } from './types';
import { getSessionActions, getHomeActions } from './reducer';
import { t, getLanguageName } from '../utils/i18n';
import {
  THINK_HEADER, THINK_BODY,
  isThinkingHeader, isThinkingBody,
  parseThinkingHeader,
  parseAgentMessageDelta,
  parseAgentMessageFinal,
} from '../domain/output-parser';

/** Visual style for a display line. */
export type LineStyle =
  | 'normal'      // green text on black
  | 'inverted'    // green bg + black text (highlight/button)
  | 'tool'        // rounded bordered box (tool use lines)
  | 'meta'        // dimmed text (status, separators)
  | 'prompt'      // user prompt highlight
  | 'separator'   // thin horizontal rule
  | 'thinking';   // dotted border box (thinking blocks)

/** A single line of display content. */
export interface DisplayLine {
  text: string;
  /** @deprecated use style instead */
  inverted: boolean;
  style: LineStyle;
  /** If this is a thinking header line, the thinking block ID (for toggle). */
  thinkingId?: number;
}

/** Structured display data for the canvas renderer. */
export interface DisplayData {
  lines: DisplayLine[];
  showLogo?: boolean;
  showSplash?: boolean;
}

function line(text: string, inverted = false, style?: LineStyle): DisplayLine {
  return { text, inverted, style: style ?? (inverted ? 'inverted' : 'normal') };
}

/**
 * Returns structured display data for the canvas renderer.
 */
export function getDisplayData(state: AppState): DisplayData {
  switch (state.screen) {
    case 'splash':
      return { showSplash: true, lines: [] };
    case 'home':
      return homeData(state);
    case 'host-list':
      return hostListData(state);
    case 'workspace-list':
      return workspaceListData(state);
    case 'session-list':
      return sessionListData(state);
    case 'session-detail':
      return sessionDetailData(state);
    case 'voice-input':
      return voiceInputData(state);
    case 'live-output':
      return liveOutputData(state);
    case 'action-result':
      return actionResultData(state);
    case 'file-browser':
      return fileBrowserData(state);
    case 'file-viewer':
      return fileViewerData(state);
    case 'session-diffs':
      return sessionDiffsData(state);
    case 'settings':
      return settingsData(state);
    case 'prompt-select':
      return promptSelectData(state);
    case 'port-browser':
      return portBrowserData(state);
    case 'schedules':
      return schedulesData(state);
    case 'team-list':
      return teamListData(state);
    case 'team-detail':
      return teamDetailData(state);
    case 'team-chat':
      return teamChatData(state);
    default:
      return homeData(state);
  }
}

/**
 * Returns the thinking block ID at the current chat highlight position,
 * or null if the highlighted row is not a thinking header.
 */
export function getThinkingIdAtHighlight(state: AppState): number | null {
  if (state.screen !== 'live-output') return null;
  const data = getDisplayData(state);
  for (const dl of data.lines) {
    if (dl.inverted && dl.thinkingId !== undefined) {
      return dl.thinkingId;
    }
  }
  return null;
}

// ── Home ──

function homeData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const total = state.sessions.length;
  const hostCount = state.hosts.length;
  const running = state.sessions.filter((s) => s.status === 'running' || s.status === 'awaiting_approval').length;
  const connLabel =
    state.connectionStatus === 'connected' ? ''
    : state.connectionStatus === 'connecting' ? ` ${t('home.connecting', lang)}`
    : ` ${t('home.disconnected', lang)}`;

  const lines: DisplayLine[] = [
    line(`OpenVide Hub${connLabel}`),
    line('\u2500'.repeat(44), false, 'separator'),
  ];

  // Per-host summary
  if (hostCount > 0) {
    for (const host of state.hosts) {
      const status = state.hostStatuses[host.id] ?? 'disconnected';
      const statusIcon = status === 'connected' ? '\u2713' : '\u2717';
      const hostSessions = state.sessions.filter((s) => s.hostId === host.id);
      const hostRunning = hostSessions.filter((s) => s.status === 'running' || s.status === 'awaiting_approval').length;
      const sesLabel = `${hostSessions.length} ses`;
      const runLabel = hostRunning > 0 ? `  ${hostRunning} run` : '';
      const maxLen = 44 - sesLabel.length - runLabel.length - 4;
      const name = host.name.length > maxLen ? host.name.slice(0, maxLen - 2) + '..' : host.name;
      const pad = 44 - name.length - sesLabel.length - runLabel.length - 3;
      lines.push(line(`${statusIcon} ${name}${' '.repeat(Math.max(1, pad))}${sesLabel}${runLabel}`, false, 'meta'));
    }
    lines.push(line('\u2500'.repeat(44), false, 'separator'));
  }

  // Summary line
  const parts = [`${total} total`, `${running} active`];
  lines.push(line(parts.join('  '), false, 'meta'));
  lines.push(line(''));

  const actions = getHomeActions(state);
  const hi = state.highlightedIndex;
  actions.forEach((action, i) => {
    lines.push(line(` ${action.label}`, i === hi));
  });

  return { showLogo: true, lines };
}

// ── Host List ──

function hostListData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const hi = state.highlightedIndex;

  if (state.hosts.length === 0) {
    return { lines: [line(`${t('hosts.title', lang)} (0)`), line(''), line(t('hosts.noHosts', lang))] };
  }

  const maxVisible = 6;
  let start = Math.max(0, hi - Math.floor(maxVisible / 2));
  const end = Math.min(state.hosts.length, start + maxVisible);
  start = Math.max(0, end - maxVisible);

  const lines: DisplayLine[] = [];
  lines.push(line(`${t('hosts.title', lang)} (${state.hosts.length})`));
  lines.push(line(''));

  if (start > 0) lines.push(line('  ...'));

  for (let i = start; i < end; i++) {
    const h = state.hosts[i];
    const status = state.hostStatuses[h.id] ?? 'disconnected';
    const statusIcon = status === 'connected' ? '\u2713' : '\u2717';
    const maxLen = 40;
    const label = h.name.length > maxLen ? h.name.slice(0, maxLen - 3) + '...' : h.name;
    lines.push(line(` ${statusIcon} ${label}`, i === hi));
  }

  if (end < state.hosts.length) lines.push(line('  ...'));

  return { lines };
}

// ── Workspace List ──

function workspaceListData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const hi = state.highlightedIndex;
  const host = state.hosts.find((h) => h.id === state.selectedHostId);
  const hostName = host?.name ?? 'Local';

  const extraItems = [t('workspace.newWorkspace', lang), t('workspace.browseFiles', lang)];
  const totalItems = state.workspaces.length + extraItems.length;

  if (state.workspaces.length === 0) {
    const lines: DisplayLine[] = [
      line(hostName),
      line(''),
      line(t('workspace.noWorkspaces', lang)),
      line(''),
    ];
    extraItems.forEach((label, i) => {
      lines.push(line(` ${label}`, hi === i));
    });
    return { lines };
  }

  const maxVisible = 5;
  let start = Math.max(0, hi - Math.floor(maxVisible / 2));
  const end = Math.min(totalItems, start + maxVisible);
  start = Math.max(0, end - maxVisible);

  const lines: DisplayLine[] = [];
  lines.push(line(`${hostName} - ${t('workspace.title', lang)}`));
  lines.push(line(''));

  if (start > 0) lines.push(line('  ...'));

  for (let i = start; i < end; i++) {
    if (i < state.workspaces.length) {
      const ws = state.workspaces[i];
      const host = ws.hostId ? state.hosts.find((h) => h.id === ws.hostId) : null;
      const hostTag = host && state.hosts.length > 1 ? ` @${host.name.slice(0, 6)}` : '';
      const runTag = ws.runningCount > 0 ? ` [${ws.runningCount} run]` : '';
      const countTag = `(${ws.sessionCount})`;
      const prefix = `${countTag}${runTag} `;
      const maxLen = 44 - prefix.length - hostTag.length - 1;
      const name = ws.name.length > maxLen ? ws.name.slice(0, maxLen - 3) + '...' : ws.name;
      lines.push(line(` ${prefix}${name}${hostTag}`, i === hi));
    } else {
      const extraIdx = i - state.workspaces.length;
      lines.push(line(` ${extraItems[extraIdx]}`, i === hi));
    }
  }

  if (end < totalItems) lines.push(line('  ...'));

  return { lines };
}

// ── Session List ──

function sessionListData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const hi = state.highlightedIndex;

  if (state.sessions.length === 0) {
    return { lines: [line(`${t('session.title', lang)} (0)`), line(''), line(t('session.noSessions', lang))] };
  }

  const maxVisible = 5;
  let start = Math.max(0, hi - Math.floor(maxVisible / 2));
  const end = Math.min(state.sessions.length, start + maxVisible);
  start = Math.max(0, end - maxVisible);

  const lines: DisplayLine[] = [];
  lines.push(line(`${t('session.title', lang)} (${state.sessions.length})`));
  lines.push(line(''));

  if (start > 0) lines.push(line('  ...'));

  for (let i = start; i < end; i++) {
    const s = state.sessions[i];
    const statusTag =
      s.status === 'running' ? t('session.statusRun', lang)
      : s.status === 'awaiting_approval' ? t('session.statusApproval', lang)
      : s.status === 'failed' ? t('session.statusFail', lang)
      : s.status === 'cancelled' ? t('session.statusCanc', lang)
      : s.status === 'interrupted' ? t('session.statusInt', lang)
      : t('session.statusIdle', lang);
    // tool (claude/codex/gemini) - status - last prompt preview
    const sessionName = s.lastPrompt ?? s.workingDirectory.split('/').pop() ?? '';
    const prefix = `${s.tool} - ${statusTag} - `;
    const maxLen = 44 - prefix.length - 1;
    const nameTrunc = sessionName.length > maxLen ? sessionName.slice(0, maxLen - 3) + '...' : sessionName;
    lines.push(line(` ${prefix}${nameTrunc}`, i === hi));
  }

  if (end < state.sessions.length) lines.push(line('  ...'));

  return { lines };
}

// ── Session Detail ──

function sessionDetailData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const session = state.sessions.find((s) => s.id === state.selectedSessionId);
  if (!session) return { lines: [line(t('session.title', lang)), line(''), line(t('session.notFound', lang))] };

  const statusBadge =
    session.status === 'running' ? t('session.running', lang)
    : session.status === 'awaiting_approval' ? t('session.awaitingApproval', lang)
    : session.status === 'failed' ? t('session.failed', lang)
    : session.status === 'cancelled' ? t('session.cancelled', lang)
    : session.status === 'interrupted' ? t('session.interrupted', lang)
    : t('session.idle', lang);

  const dir = session.workingDirectory.split('/').pop() ?? session.workingDirectory;
  const host = session.hostId ? state.hosts.find((h) => h.id === session.hostId) : null;
  const hostLabel = host ? ` @${host.name}` : '';
  const header = `${session.tool.toUpperCase()} ${statusBadge}${hostLabel}`;

  const lines: DisplayLine[] = [
    line(header),
    line(`~/${dir}`),
    line('────────────────────'),
  ];

  if (session.lastPrompt) {
    const prompt = session.lastPrompt.length > 60 ? session.lastPrompt.slice(0, 59) + '..' : session.lastPrompt;
    lines.push(line(`"${prompt}"`));
  }
  if (session.lastError) {
    const err = session.lastError.length > 60 ? session.lastError.slice(0, 59) + '..' : session.lastError;
    lines.push(line(`! ${err}`));
  }
  lines.push(line(''));

  const actions = getSessionActions(state);
  const hi = state.highlightedIndex;
  actions.forEach((action, i) => {
    lines.push(line(` ${action.label}`, i === hi));
  });

  return { lines };
}

// ── Voice Input ──

function voiceInputData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const session = state.sessions.find((s) => s.id === state.selectedSessionId);
  const toolName = session ? session.tool.toUpperCase() : '';

  const lines: DisplayLine[] = [
    line(`${toolName} - ${t('voice.title', lang)}`),
    line('────────────────────'),
    line(''),
  ];

  if (state.voiceListening) {
    lines.push(line(t('voice.listening', lang)));
  } else {
    lines.push(line(t('voice.processing', lang)));
  }

  lines.push(line(''));

  if (state.voiceText) {
    // Word-wrap transcription at ~30 chars
    const words = state.voiceText.split(' ');
    let current = '';
    for (const word of words) {
      if (current.length + word.length + 1 > 30) {
        lines.push(line(`"${current}`));
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(line(`"${current}"`));
  }

  return { lines };
}

// ── Live Output ──

function liveOutputData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const session = state.sessions.find((s) => s.id === state.selectedSessionId);
  const toolName = session ? session.tool.toUpperCase() : '';
  const statusTag = state.voiceListening ? ` ${t('output.listening', lang)}`
    : session?.status === 'running' ? ` ${t('output.live', lang)}`
    : session?.status === 'awaiting_approval' ? ` ${t('output.approval', lang)}`
    : ` ${t('output.done', lang)}`;

  const headerLines: DisplayLine[] = [
    line(`${toolName}${statusTag}`, false, state.voiceListening ? 'inverted' : 'normal'),
    line('────────────────────'),
  ];

  // Show voice transcription above output when listening
  if (state.voiceListening || state.voiceText) {
    const voiceLabel = state.voiceText ? `"${state.voiceText}"` : t('voice.speakNow', lang);
    headerLines.push(line(voiceLabel, false, 'prompt'));
    headerLines.push(line(''));
  }

  const maxChars = 44;
  const maxDisplayLines = 8;
  const total = state.outputLines.length;

  if (total === 0) {
    return { lines: [...headerLines, line(''), line(t('output.waiting', lang))] };
  }

  // Build visible lines, handling thinking collapse/expand
  const wrapped: DisplayLine[] = [];
  let prevStyle: LineStyle | null = null;
  const finalizedAgentMessageIds = new Set<string>();
  for (const text of state.outputLines) {
    const agentFinal = parseAgentMessageFinal(text);
    if (agentFinal) finalizedAgentMessageIds.add(agentFinal.id);
  }

  for (const text of state.outputLines) {
    const agentFinal = parseAgentMessageFinal(text);
    const agentDelta = parseAgentMessageDelta(text);
    const agentMessage = agentFinal ?? (
      agentDelta && !finalizedAgentMessageIds.has(agentDelta.id) ? agentDelta : null
    );
    if (agentMessage) {
      const messageText = agentMessage.text.trim();
      if (!messageText) continue;
      const style: LineStyle = 'normal';
      if (prevStyle !== null && style !== prevStyle) {
        wrapped.push(line('', false, 'normal'));
      }
      prevStyle = style;
      if (messageText.length <= maxChars) {
        wrapped.push(line(messageText, false, style));
      } else {
        for (let i = 0; i < messageText.length; i += maxChars) {
          wrapped.push(line(messageText.slice(i, i + maxChars), false, style));
        }
      }
      continue;
    }

    // Thinking header: show collapsed or expanded
    if (isThinkingHeader(text)) {
      const parsed = parseThinkingHeader(text);
      if (parsed) {
        const expanded = state.expandedThinking.includes(parsed.id);
        const prefix = expanded ? 'v ' : '> ';
        // Collapsed: single-line truncated preview. Expanded: full wrapped text.
        const headerText = `${prefix}${parsed.summary}`;
        if (prevStyle !== null && prevStyle !== 'thinking') {
          wrapped.push(line('', false, 'normal'));
        }
        prevStyle = 'thinking';
        if (!expanded) {
          // Collapsed: one line, truncated
          const dl = line(headerText.length > maxChars ? headerText.slice(0, maxChars - 3) + '...' : headerText, false, 'thinking');
          dl.thinkingId = parsed.id;
          wrapped.push(dl);
        } else {
          // Expanded: wrap header across multiple lines
          for (let i = 0; i < headerText.length; i += maxChars) {
            const dl = line(headerText.slice(i, i + maxChars), false, 'thinking');
            dl.thinkingId = parsed.id;
            wrapped.push(dl);
          }
        }
      }
      continue;
    }

    // Thinking body: only show if expanded
    if (isThinkingBody(text)) {
      const rest = text.slice(4);
      const sepIdx = rest.indexOf('§');
      if (sepIdx >= 0) {
        const id = parseInt(rest.slice(0, sepIdx), 10);
        if (!state.expandedThinking.includes(id)) continue;
        const bodyText = rest.slice(sepIdx + 1);
        // Detect tool lines inside thinking body
        const bodyStyle: LineStyle = bodyText.startsWith('TOOL ') ? 'tool' : 'thinking';
        const indent = bodyStyle === 'tool' ? '' : '  ';
        const displayText = bodyStyle === 'tool' ? `>> ${bodyText.slice(5)}` : bodyText;
        prevStyle = bodyStyle;
        if (displayText.length + indent.length <= maxChars) {
          const dl = line(`${indent}${displayText}`, false, bodyStyle);
          dl.thinkingId = id;
          wrapped.push(dl);
        } else {
          const wrap = maxChars - indent.length;
          for (let i = 0; i < displayText.length; i += wrap) {
            const dl = line(`${indent}${displayText.slice(i, i + wrap)}`, false, bodyStyle);
            dl.thinkingId = id;
            wrapped.push(dl);
          }
        }
      }
      continue;
    }

    // Prompt lines (§P§ prefix from parser)
    if (text.startsWith('§P§')) {
      const promptText = text.slice(3);
      if (prevStyle !== null && prevStyle !== 'prompt') {
        wrapped.push(line('', false, 'normal'));
      }
      prevStyle = 'prompt';
      if (promptText.length <= maxChars) {
        wrapped.push(line(promptText, false, 'prompt'));
      } else {
        for (let i = 0; i < promptText.length; i += maxChars) {
          wrapped.push(line(promptText.slice(i, i + maxChars), false, 'prompt'));
        }
      }
      continue;
    }

    // Regular lines
    const style = classifyOutputLine(text);
    if (prevStyle !== null && style !== prevStyle) {
      wrapped.push(line('', false, 'normal'));
    }
    prevStyle = style;
    if (text.length <= maxChars) {
      wrapped.push(line(text, false, style));
    } else {
      for (let i = 0; i < text.length; i += maxChars) {
        wrapped.push(line(text.slice(i, i + maxChars), false, style));
      }
    }
  }

  // Always leave 1 blank line at the end
  wrapped.push(line('', false, 'normal'));

  // outputScrollOffset = lines up from bottom (0 = at bottom, 1 = one up, etc.)
  const maxFromBottom = Math.max(0, wrapped.length - maxDisplayLines);
  const clampedFromBottom = Math.min(state.outputScrollOffset, maxFromBottom);
  const effectiveOffset = Math.max(0, wrapped.length - maxDisplayLines - clampedFromBottom);

  const start = Math.max(0, effectiveOffset);
  const end = Math.min(wrapped.length, start + maxDisplayLines);

  // chatHighlight is relative to the viewport (0 = first visible row)
  const visibleCount = end - start;
  const hi = Math.max(0, Math.min(state.chatHighlight, visibleCount - 1));

  const resultLines = [...headerLines];
  for (let i = start; i < end; i++) {
    const dl = wrapped[i];
    if (i - start === hi) {
      resultLines.push({ ...dl, inverted: true, style: 'inverted', thinkingId: dl.thinkingId });
    } else {
      resultLines.push(dl);
    }
  }

  return { lines: resultLines };
}

// ── File Browser ──

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function fileBrowserData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const hi = state.browserHighlight;
  const maxChars = 44;

  // Header: truncated path
  const pathDisplay = state.browserPath.length > maxChars
    ? '...' + state.browserPath.slice(-(maxChars - 3))
    : state.browserPath;

  const lines: DisplayLine[] = [
    line(pathDisplay, false, 'meta'),
    line(''),
  ];

  if (state.browserEntries.length === 0 && hi === 0) {
    lines.push(line(' ..', true));
    lines.push(line(''));
    lines.push(line(t('browser.loading', lang)));
    return { lines };
  }

  // Filter hidden files unless setting is enabled
  const filtered = state.settings.showHiddenFiles
    ? state.browserEntries
    : state.browserEntries.filter((e) => !e.name.startsWith('.'));

  // Sort: directories first, then files, alphabetically within each group
  const sorted = [...filtered].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Items: ".." + (pick mode: "Select this folder") + sorted entries
  const pickOffset = state.browserPickMode ? 1 : 0;
  const totalItems = sorted.length + 1 + pickOffset;
  const maxVisible = 6;
  let start = Math.max(0, hi - Math.floor(maxVisible / 2));
  const end = Math.min(totalItems, start + maxVisible);
  start = Math.max(0, end - maxVisible);

  if (start > 0) lines.push(line('  ...'));

  for (let i = start; i < end; i++) {
    if (i === 0) {
      lines.push(line(' ..', i === hi));
    } else if (state.browserPickMode && i === 1) {
      lines.push(line(` ${t('browser.selectFolder', lang)}`, i === hi));
    } else {
      const entry = sorted[i - 1 - pickOffset];
      if (!entry) continue;
      if (entry.type === 'dir') {
        const nameDisplay = entry.name + '/';
        const maxLen = maxChars - 1;
        const label = nameDisplay.length > maxLen ? nameDisplay.slice(0, maxLen - 3) + '...' : nameDisplay;
        lines.push(line(` ${label}`, i === hi));
      } else {
        const sizeStr = formatFileSize(entry.size);
        const maxLen = maxChars - sizeStr.length - 2;
        const name = entry.name.length > maxLen ? entry.name.slice(0, maxLen - 3) + '...' : entry.name;
        const pad = maxChars - name.length - sizeStr.length - 1;
        lines.push(line(` ${name}${' '.repeat(Math.max(1, pad))}${sizeStr}`, i === hi));
      }
    }
  }

  if (end < totalItems) lines.push(line('  ...'));

  return { lines };
}

// ── File Viewer ──

function fileViewerData(state: AppState): DisplayData {
  const maxChars = 44;
  const maxDisplayLines = 8;

  // Header: filename
  const fileName = state.viewingFile ?? 'file';
  const headerDisplay = fileName.length > maxChars ? fileName.slice(0, maxChars - 3) + '...' : fileName;

  const headerLines: DisplayLine[] = [
    line(headerDisplay, false, 'meta'),
    line(''),
  ];

  if (!state.fileContent) {
    return { lines: [...headerLines, line(t('browser.loading', state.settings.language))] };
  }

  // Word-wrap content lines
  const rawLines = state.fileContent.split('\n');
  const wrapped: string[] = [];
  for (const raw of rawLines) {
    if (raw.length <= maxChars) {
      wrapped.push(raw);
    } else {
      for (let i = 0; i < raw.length; i += maxChars) {
        wrapped.push(raw.slice(i, i + maxChars));
      }
    }
  }

  // Clamp scroll offset
  const maxOffset = Math.max(0, wrapped.length - maxDisplayLines);
  const offset = Math.min(state.fileScrollOffset, maxOffset);

  const visibleLines = wrapped.slice(offset, offset + maxDisplayLines);
  const resultLines = [...headerLines];
  for (const vl of visibleLines) {
    resultLines.push(line(vl));
  }

  // Show scroll position indicator
  if (wrapped.length > maxDisplayLines) {
    const pct = Math.round((offset / maxOffset) * 100);
    resultLines.push(line(`--- ${pct}% ---`, false, 'meta'));
  }

  return { lines: resultLines };
}

// ── Action Result ──

function actionResultData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const result = state.pendingResult;
  if (!result) {
    return { lines: [line(t('result.title', lang)), line(''), line(t('result.noResult', lang)), line(''), line(` ${t('result.continue', lang)}`, true)] };
  }

  const icon = result.success ? t('result.ok', lang) : t('result.fail', lang);
  const status = result.success ? t('result.completed', lang) : t('result.actionFailed', lang);

  return {
    lines: [
      line(`${icon} ${result.action.toUpperCase()}`),
      line(''),
      line(result.message),
      line('────────────────────'),
      line(status),
      line(''),
      line(` ${t('result.continue', lang)}`, true),
    ],
  };
}

// ── Session Diffs (Phase 4) ──

function sessionDiffsData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const hi = state.highlightedIndex;
  const count = state.diffFiles.length;

  const lines: DisplayLine[] = [
    line(`${t('diffs.title', lang)}: ${count} ${count !== 1 ? t('diffs.files', lang) : t('diffs.file', lang)}`),
    line('────────────────────'),
  ];

  if (count === 0) {
    lines.push(line(''));
    lines.push(line(t('browser.loading', lang)));
    return { lines };
  }

  const maxVisible = 5;
  let start = Math.max(0, hi - Math.floor(maxVisible / 2));
  const end = Math.min(count, start + maxVisible);
  start = Math.max(0, end - maxVisible);

  if (start > 0) lines.push(line('  ...'));

  for (let i = start; i < end; i++) {
    const f = state.diffFiles[i];
    const newTag = f.isNew ? `${t('diffs.new', lang)} ` : '';
    const stats = f.isNew
      ? `+${f.added}`
      : `+${f.added} -${f.removed}`;
    const maxLen = 44 - stats.length - newTag.length - 2;
    const name = f.path.length > maxLen ? f.path.slice(0, maxLen - 3) + '...' : f.path;
    const pad = 44 - newTag.length - name.length - stats.length - 1;
    lines.push(line(`${i === hi ? '\u258C' : ' '}${newTag}${name}${' '.repeat(Math.max(1, pad))}${stats}`, i === hi));
  }

  if (end < count) lines.push(line('  ...'));

  return { lines };
}

// ── Settings (Phase 5) ──

const LANG_LABELS: Record<string, string> = {
  'en-US': 'EN', 'it-IT': 'IT', 'es-ES': 'ES', 'fr-FR': 'FR',
  'de-DE': 'DE', 'pt-BR': 'PT', 'zh-CN': 'ZH', 'ja-JP': 'JA',
};

function settingsData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const hi = state.highlightedIndex;
  const s = state.settings;

  const items = [
    `${t('settings.language', lang)}: ${getLanguageName(s.language)}`,
    `${t('settings.voice', lang)}: ${LANG_LABELS[s.voiceLang] ?? s.voiceLang}`,
    `${t('settings.toolDetails', lang)}: ${s.showToolDetails ? t('settings.on', lang) : t('settings.off', lang)}`,
    `${t('settings.poll', lang)}: ${s.pollInterval / 1000}s`,
    `${t('settings.hiddenFiles', lang)}: ${s.showHiddenFiles ? t('settings.show', lang) : t('settings.hide', lang)}`,
  ];

  const lines: DisplayLine[] = [
    line(t('settings.title', lang)),
    line('────────────────────'),
    line(''),
  ];

  items.forEach((label, i) => {
    lines.push(line(` ${label}`, i === hi));
  });

  return { lines };
}

// ── Prompt Select (Phase 6) ──

function promptSelectData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const hi = state.highlightedIndex;

  const lines: DisplayLine[] = [
    line(t('prompt.sendPrompt', lang)),
    line('────────────────────'),
  ];

  lines.push(line(` ${t('prompt.voiceInput', lang)}`, hi === 0));

  const maxVisible = 5;
  const totalItems = state.prompts.length + 1; // +1 for voice
  let start = Math.max(1, hi - Math.floor(maxVisible / 2));
  const end = Math.min(totalItems, start + maxVisible);
  start = Math.max(1, end - maxVisible);

  if (start > 1) lines.push(line('  ...'));

  for (let i = start; i < end; i++) {
    const p = state.prompts[i - 1];
    if (!p) continue;
    const maxLen = 42;
    const label = p.label.length > maxLen ? p.label.slice(0, maxLen - 3) + '...' : p.label;
    lines.push(line(` "${label}"`, i === hi));
  }

  if (end < totalItems) lines.push(line('  ...'));

  return { lines };
}

// ── Port Browser (Phase 7) ──

function portBrowserData(state: AppState): DisplayData {
  const lang = state.settings.language;
  const hi = state.highlightedIndex;
  const count = state.ports.length;

  const lines: DisplayLine[] = [
    line(`${t('ports.title', lang)} (${count} ${t('ports.listening', lang)})`),
    line('────────────────────'),
  ];

  if (count === 0) {
    lines.push(line(''));
    lines.push(line(t('browser.loading', lang)));
    return { lines };
  }

  const maxVisible = 5;
  let start = Math.max(0, hi - Math.floor(maxVisible / 2));
  const end = Math.min(count, start + maxVisible);
  start = Math.max(0, end - maxVisible);

  if (start > 0) lines.push(line('  ...'));

  for (let i = start; i < end; i++) {
    const p = state.ports[i];
    const portStr = `:${p.port}`;
    const maxLen = 44 - portStr.length - 2;
    const proc = p.process.length > maxLen ? p.process.slice(0, maxLen - 3) + '...' : p.process;
    const pad = 44 - portStr.length - proc.length - 1;
    lines.push(line(`${i === hi ? '\u258C' : ' '}${portStr}${' '.repeat(Math.max(1, pad))}${proc}`, i === hi));
  }

  if (end < count) lines.push(line('  ...'));

  return { lines };
}

// ── Schedules ──

function schedulesData(state: AppState): DisplayData {
  const hi = state.highlightedIndex;
  const count = state.scheduledTasks.length;

  const lines: DisplayLine[] = [
    line(`Schedules (${count})`),
    line('\u2500'.repeat(20), false, 'separator'),
  ];

  if (count === 0) {
    lines.push(line(''));
    lines.push(line('No scheduled tasks'));
    return { lines };
  }

  const maxVisible = 5;
  let start = Math.max(0, hi - Math.floor(maxVisible / 2));
  const end = Math.min(count, start + maxVisible);
  start = Math.max(0, end - maxVisible);

  if (start > 0) lines.push(line('  ...'));

  for (let i = start; i < end; i++) {
    const t = state.scheduledTasks[i];
    const status = t.lastStatus ? ` [${t.lastStatus}]` : '';
    const maxLen = 44 - status.length - 1;
    const name = t.name.length > maxLen ? t.name.slice(0, maxLen - 3) + '...' : t.name;
    lines.push(line(` ${name}${status}`, i === hi));
  }

  if (end < count) lines.push(line('  ...'));

  return { lines };
}

// ── Team List ──

function teamListData(state: AppState): DisplayData {
  const hi = state.highlightedIndex;
  const count = state.teams.length;

  const lines: DisplayLine[] = [
    line(`Teams (${count})`),
    line('\u2500'.repeat(20), false, 'separator'),
  ];

  if (count === 0) {
    lines.push(line(''));
    lines.push(line('No teams'));
    return { lines };
  }

  const maxVisible = 5;
  let start = Math.max(0, hi - Math.floor(maxVisible / 2));
  const end = Math.min(count, start + maxVisible);
  start = Math.max(0, end - maxVisible);

  if (start > 0) lines.push(line('  ...'));

  for (let i = start; i < end; i++) {
    const team = state.teams[i];
    const info = `${team.memberCount}m ${team.taskCount}t`;
    const maxLen = 44 - info.length - 2;
    const name = team.name.length > maxLen ? team.name.slice(0, maxLen - 3) + '...' : team.name;
    const pad = 44 - name.length - info.length - 1;
    lines.push(line(` ${name}${' '.repeat(Math.max(1, pad))}${info}`, i === hi));
  }

  if (end < count) lines.push(line('  ...'));

  return { lines };
}

// ── Team Detail ──

function teamDetailData(state: AppState): DisplayData {
  const hi = state.highlightedIndex;
  const team = state.teams.find((t) => t.id === state.selectedTeamId);
  const teamName = team?.name ?? 'Team';

  const lines: DisplayLine[] = [
    line(teamName),
    line('\u2500'.repeat(20), false, 'separator'),
  ];

  if (state.teamTasks.length === 0) {
    lines.push(line(''));
    lines.push(line('Loading tasks...'));
    return { lines };
  }

  const statusOrder = ['TODO', 'IN PROGRESS', 'DONE', 'REVIEW', 'APPROVED'];
  const grouped: Record<string, typeof state.teamTasks> = {};
  for (const task of state.teamTasks) {
    const s = task.status.toUpperCase();
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(task);
  }

  let taskIndex = 0;
  for (const status of statusOrder) {
    const tasks = grouped[status];
    if (!tasks || tasks.length === 0) continue;
    lines.push(line(`-- ${status} (${tasks.length}) --`, false, 'meta'));
    for (const task of tasks) {
      const ownerTag = task.owner ? ` @${task.owner}` : '';
      const maxLen = 44 - ownerTag.length - 1;
      const subject = task.subject.length > maxLen ? task.subject.slice(0, maxLen - 3) + '...' : task.subject;
      lines.push(line(` ${subject}${ownerTag}`, taskIndex === hi));
      taskIndex++;
    }
  }

  return { lines };
}

// ── Team Chat ──

function teamChatData(state: AppState): DisplayData {
  const lines: DisplayLine[] = [
    line('Team Chat'),
    line('\u2500'.repeat(20), false, 'separator'),
  ];

  if (state.teamMessages.length === 0) {
    lines.push(line(''));
    lines.push(line('No messages'));
    return { lines };
  }

  const maxChars = 44;
  const maxDisplayLines = 8;

  const wrapped: DisplayLine[] = [];
  for (const msg of state.teamMessages) {
    const header = `${msg.from} \u2192 ${msg.to}:`;
    wrapped.push(line(header, false, 'meta'));
    if (msg.text.length <= maxChars) {
      wrapped.push(line(msg.text));
    } else {
      for (let i = 0; i < msg.text.length; i += maxChars) {
        wrapped.push(line(msg.text.slice(i, i + maxChars)));
      }
    }
  }

  // Scroll from bottom like chat
  const maxFromBottom = Math.max(0, wrapped.length - maxDisplayLines);
  const clampedFromBottom = Math.min(state.outputScrollOffset, maxFromBottom);
  const effectiveOffset = Math.max(0, wrapped.length - maxDisplayLines - clampedFromBottom);

  const start = Math.max(0, effectiveOffset);
  const end = Math.min(wrapped.length, start + maxDisplayLines);

  const visibleCount = end - start;
  const hi = Math.max(0, Math.min(state.chatHighlight, visibleCount - 1));

  for (let i = start; i < end; i++) {
    const dl = wrapped[i];
    if (i - start === hi) {
      lines.push({ ...dl, inverted: true, style: 'inverted' });
    } else {
      lines.push(dl);
    }
  }

  return { lines };
}

// ── Output line style classification ──

function classifyOutputLine(text: string): LineStyle {
  if (text.startsWith('>> ')) return 'tool';
  if (text.startsWith('TOOL ')) return 'tool';
  if (text.startsWith('--- ') || text.startsWith('[OK]') || text.startsWith('[FAIL]')) return 'meta';
  if (text.startsWith('(') && text.endsWith(')')) return 'meta'; // thinking
  if (text.startsWith('[') && text.includes('] Starting')) return 'meta'; // init
  if (text.startsWith('Thinking...')) return 'meta';
  if (text.startsWith('! ')) return 'meta'; // stderr
  return 'normal';
}
