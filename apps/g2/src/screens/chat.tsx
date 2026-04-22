import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useDrawerHeader, Button } from 'even-toolkit/web';
import { IcChevronBack } from 'even-toolkit/web/icons/svg-icons';
import { useSessionStream } from '../hooks/use-session-stream';
import { useSessions } from '../hooks/use-sessions';
import { useModels } from '../hooks/use-models';
import { useSettings } from '../hooks/use-settings';
import { usePrompts } from '../hooks/use-prompts';
import { useSendPrompt, useCancelSession, useRespondToPermission } from '../hooks/use-send-prompt';
import { useTranslation } from '../hooks/useTranslation';
import { StatusDot } from '../components/shared/status-dot';
import { ChatBubble } from '../components/chat/chat-bubble';
import { ChatInput } from '../components/chat/chat-input';
import { CodeBlock } from '../components/chat/code-block';
import { ThinkingBlock } from '../components/chat/thinking-block';
import { ToolUseCard } from '../components/chat/tool-use-card';
import { PermissionApprovalCard } from '../components/chat/permission-approval-card';
import { IcEditSettings, IcFeatInterfaceSettings } from 'even-toolkit/web/icons/svg-icons';
import type { ChatMessage, PendingPermissionRequest, PermissionDecision } from '../types';

/* ── Thinking label (cycles verbs like Claude Code) ── */

const THINKING_VERBS = [
  'Thinking', 'Reasoning', 'Pondering', 'Considering', 'Analyzing',
  'Processing', 'Evaluating', 'Reflecting', 'Examining', 'Working',
];

function ThinkingLabel() {
  const [verb, setVerb] = useState(() => THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)]);

  useEffect(() => {
    const id = setInterval(() => {
      setVerb(THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)]);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="text-[13px] tracking-[-0.13px] text-text-dim italic font-normal">
      {verb}…
    </span>
  );
}

function permissionDecisionText(decision: PermissionDecision): string {
  if (decision === 'approve_once') return 'Approved once';
  if (decision === 'reject') return 'Rejected';
  return 'Aborted run';
}

function permissionStatusText(status: PendingPermissionRequest['status']): string {
  if (status === 'approved') return 'Approved once';
  if (status === 'rejected') return 'Rejected';
  if (status === 'cancelled') return 'Aborted run';
  if (status === 'expired') return 'Permission request expired';
  return '';
}

function PermissionResolutionNotice({
  label,
  continuing,
}: {
  label: string;
  continuing: boolean;
}) {
  return (
    <div className="self-start max-w-[88%] rounded-[6px] border border-border bg-surface px-3 py-2 text-[13px] text-text-dim">
      {label}{continuing ? '. Continuing...' : '.'}
    </div>
  );
}

function splitMessagesAroundLatestUser(messages: ChatMessage[]): {
  before: ChatMessage[];
  after: ChatMessage[];
} {
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user');
  if (lastUserIndex < 0) return { before: messages, after: [] };
  return {
    before: messages.slice(0, lastUserIndex + 1),
    after: messages.slice(lastUserIndex + 1),
  };
}

/* ── Provider color lookup ── */
function getProviderColor(tool?: string): string {
  const t = (tool ?? '').toLowerCase();
  if (t.includes('claude')) return '#C4704B';
  if (t.includes('codex')) return '#10A37F';
  if (t.includes('gemini')) return '#4285F4';
  return 'var(--color-accent)';
}

/* ── Content parser ── */
function renderContent(content: string, showToolDetails: boolean): ReactNode[] {
  if (!content.trim()) return [];

  const lines = content.split('\n');
  const elements: ReactNode[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let codeLang = '';
  let key = 0;

  const flushCode = () => {
    if (codeLines.length > 0) {
      const text = codeLines.join('\n');
      const isDiff = codeLines.some((l) => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@'));
      elements.push(<CodeBlock key={key++} code={text} language={codeLang || undefined} diff={isDiff} />);
      codeLines = [];
      codeLang = '';
    }
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // Tool use lines
    if (line.startsWith('>> ')) {
      const toolText = line.slice(3);
      const toolName = toolText.split(' ')[0] ?? 'tool';
      const toolInput = toolText.slice(toolName.length).trim();

      // AskUserQuestion: show the question as highlighted text, not a tool card
      if (toolName === 'AskUserQuestion' && toolInput) {
        elements.push(
          <div key={key++} className="text-[13px] tracking-[-0.13px] text-accent font-normal bg-surface rounded-[6px] px-3 py-2 my-1">
            {toolInput}
          </div>,
        );
        continue;
      }

      if (showToolDetails) {
        elements.push(
          <ToolUseCard key={key++} name={toolName} input={toolInput || undefined} status="done" />,
        );
      }
      continue;
    }

    // Error lines
    if (line.startsWith('! ')) {
      elements.push(
        <div key={key++} className="text-[13px] tracking-[-0.13px] text-negative">
          {line}
        </div>,
      );
      continue;
    }

    // Regular text
    if (line.trim()) {
      elements.push(
        <span key={key++}>
          {line}
          <br />
        </span>,
      );
    }
  }

  // Flush remaining code block
  if (inCode) {
    flushCode();
  }

  return elements;
}

/* ── Chat Screen ── */
export function ChatRoute() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('id') ?? '';
  const navigate = useNavigate();

  const { data: sessions } = useSessions();
  const messages = useSessionStream(sessionId, sessions);
  const { data: models } = useModels();
  const { data: settings } = useSettings();
  const { data: prompts } = usePrompts();
  const sendPrompt = useSendPrompt(sessions);
  const cancelSession = useCancelSession(sessions);
  const respondToPermission = useRespondToPermission(sessions);
  const { t } = useTranslation();

  const session = sessions?.find((s) => s.id === sessionId);
  const toolName = session?.tool ?? 'Session';
  // Only user-configured prompts — built-in library entries are hidden.
  const customPrompts = (prompts ?? []).filter((p) => !p.isBuiltIn);

  // Force nav back to /sessions (or /workspace) with replace semantics so the
  // forward history (which would otherwise point back to /chat) is truncated.
  const backTarget = session?.workingDirectory
    ? `/workspace?path=${encodeURIComponent(session.workingDirectory)}${session.hostId ? `&hostId=${session.hostId}` : ''}`
    : '/sessions';
  useDrawerHeader({
    title: t('web.chat') ?? 'Chat',
    left: (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate(backTarget, { replace: true })}
      >
        <IcChevronBack width={18} height={18} />
      </Button>
    ),
  });
  const dirName = session?.workingDirectory?.split('/').pop() ?? '';
  const providerColor = getProviderColor(session?.tool);
  const isRunning = session?.status === 'running';
  const pendingPermission = session?.pendingPermission?.status === 'pending' ? session.pendingPermission : null;
  const resolvedPermission = session?.pendingPermission && session.pendingPermission.status !== 'pending'
    ? session.pendingPermission
    : null;
  const isAwaitingApproval = session?.status === 'awaiting_approval';

  // Detect if Claude is waiting for user reply
  // When session is idle and last assistant message ends with a question
  const lastMsg = messages[messages.length - 1];
  const lastContent = lastMsg?.content ?? '';
  const isPendingReply = !isRunning && !isAwaitingApproval && session?.status === 'idle' && lastMsg?.role === 'assistant' &&
    messages.length > 1 && lastContent.trim().endsWith('?');

  const [input, setInput] = useState('');
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [selectedMode, setSelectedMode] = useState('auto');
  const [selectedModel, setSelectedModel] = useState(session?.model ?? '');
  const [pendingUserMsg, setPendingUserMsg] = useState<string | null>(null);
  const [permissionDecision, setPermissionDecision] = useState<{
    requestId: string;
    decision: PermissionDecision;
  } | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Model options filtered by tool
  const toolModels: Record<string, { id: string; label: string }[]> = {
    claude: [
      { id: 'opus', label: 'Opus' },
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'haiku', label: 'Haiku' },
    ],
    codex: (models?.filter(m => !m.hidden) ?? []).map(m => ({ id: m.id, label: m.displayName })),
    gemini: [
      { id: 'gemini-2.5-pro', label: '2.5 Pro' },
      { id: 'gemini-2.5-flash', label: '2.5 Flash' },
    ],
  };
  const modelItems = toolModels[session?.tool ?? 'claude'] ?? toolModels.claude;
  const modeItems = [
    { id: 'auto', label: 'Auto' },
    { id: 'code', label: 'Code' },
    { id: 'plan', label: 'Plan' },
    { id: 'chat', label: 'Chat' },
  ];

  // Context percentage estimate (based on message count)
  const contextPercent = messages.length > 0 ? Math.min(Math.round((messages.length / 100) * 100), 99) : 0;

  // Always scroll to the latest message — both on session change and on any
  // new incoming content. The user explicitly wants the view pinned to the end.
  useEffect(() => {
    requestAnimationFrame(() => scrollToLatest('auto'));
  }, [
    messages,
    pendingUserMsg,
    permissionDecision,
    pendingPermission?.requestId,
    resolvedPermission?.status,
    sessionId,
    scrollToLatest,
  ]);

  useEffect(() => {
    setPermissionDecision(null);
  }, [sessionId]);

  useEffect(() => {
    if (!permissionDecision) return;
    const currentRequestId = pendingPermission?.requestId ?? resolvedPermission?.requestId ?? null;
    if (currentRequestId !== permissionDecision.requestId) {
      setPermissionDecision(null);
      return;
    }
    if (resolvedPermission?.requestId === permissionDecision.requestId) {
      setPermissionDecision(null);
    }
  }, [pendingPermission?.requestId, permissionDecision, resolvedPermission?.requestId, resolvedPermission?.status]);

  const handleScroll = useCallback(() => {
    // Intentional no-op: the chat view is always pinned to the latest message.
    // The "Jump to latest" helper button is gone for the same reason.
  }, []);

  // Clear pending msg when stream delivers a user message
  useEffect(() => {
    if (pendingUserMsg && messages.some((m) => m.role === 'user' && m.content.includes(pendingUserMsg.slice(0, 30)))) {
      setPendingUserMsg(null);
    }
  }, [messages, pendingUserMsg]);

  const doSend = useCallback(() => {
    const text = input.trim();
    if (!text || !sessionId) return;
    setInput('');
    setPendingUserMsg(text);
    setPermissionDecision(null);
    scrollToLatest('auto');
    const opts: any = { sessionId, prompt: text };
    if (selectedMode !== 'auto') opts.mode = selectedMode;
    if (selectedModel && selectedModel !== session?.model) opts.model = selectedModel;
    sendPrompt.mutate(opts);
  }, [input, scrollToLatest, selectedMode, selectedModel, sendPrompt, session?.model, sessionId]);

  const sendQuickPrompt = useCallback((prompt: string) => {
    if (!sessionId) return;
    const text = prompt.trim();
    if (!text) return;
    setPendingUserMsg(text);
    setPermissionDecision(null);
    scrollToLatest('auto');
    const opts: any = { sessionId, prompt: text };
    if (selectedMode !== 'auto') opts.mode = selectedMode;
    if (selectedModel && selectedModel !== session?.model) opts.model = selectedModel;
    sendPrompt.mutate(opts);
  }, [scrollToLatest, selectedMode, selectedModel, sendPrompt, session?.model, sessionId]);

  const handleCancel = useCallback(() => {
    if (sessionId) cancelSession.mutate(sessionId);
  }, [sessionId, cancelSession]);

  const handlePermissionDecision = useCallback((decision: PermissionDecision) => {
    if (!sessionId || !pendingPermission) return;
    setPermissionDecision({
      requestId: pendingPermission.requestId,
      decision,
    });
    respondToPermission.mutate({
      sessionId,
      requestId: pendingPermission.requestId,
      decision,
    });
  }, [pendingPermission, respondToPermission, sessionId]);

  const handlePromptSelect = (prompt: string) => {
    sendQuickPrompt(prompt);
    setShowPromptPicker(false);
  };

  const showToolDetails = settings?.showToolDetails ?? true;
  const fallbackMessages: ChatMessage[] = messages.length === 0 && session?.lastPrompt
    ? [{ role: 'user', content: session.lastPrompt, timestamp: new Date(session.updatedAt).getTime() }]
    : messages.length === 0 && pendingPermission
      ? [{ role: 'user', content: t('chat.lastPromptUnavailable'), timestamp: new Date(session?.updatedAt ?? Date.now()).getTime() }]
    : messages;
  const resolvedLabel = resolvedPermission
    ? permissionStatusText(resolvedPermission.status)
    : (permissionDecision ? permissionDecisionText(permissionDecision.decision) : '');
  const showResolutionNotice = !!resolvedLabel && !pendingPermission;
  const permissionCanContinue = resolvedPermission
    ? resolvedPermission.status === 'approved'
    : permissionDecision?.decision === 'approve_once';
  const isContinuingAfterPermission = !!permissionDecision
    && permissionDecision.decision === 'approve_once'
    && permissionCanContinue
    && isRunning
    && !messages.some((msg) => msg.role === 'assistant' && msg.content.trim());
  const isTerminalPermissionResolution = showResolutionNotice && !permissionCanContinue;
  const showInlineResolutionNotice = showResolutionNotice && !isTerminalPermissionResolution;
  const showTerminalResolutionNotice = showResolutionNotice && isTerminalPermissionResolution;
  const shouldPlacePermissionInTurn = !!pendingPermission || showResolutionNotice;
  const visibleMessageGroups = shouldPlacePermissionInTurn
    ? splitMessagesAroundLatestUser(fallbackMessages)
    : { before: fallbackMessages, after: [] };

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* ── Header ── */}
      <div className="shrink-0 px-3 py-2 flex items-center gap-3">
        <StatusDot status={session?.status ?? 'idle'} />
        <span className="data-mono uppercase">{toolName}</span>
        <span className="data-mono flex-1 truncate">~/{dirName}</span>
        {session?.model && (
          <span className="data-mono">{session.model}</span>
        )}
        {contextPercent > 0 && (
          <span className="data-mono">{contextPercent}%</span>
        )}
      </div>
      <div className="h-[2px] shrink-0" style={{ background: providerColor }} />

      {/* ── Pending reply banner ── */}
      {isPendingReply && (
        <div className="shrink-0 px-3 py-2 bg-[var(--color-accent-warning)] flex items-center gap-3 border-b border-border">
          <span className="text-[13px] tracking-[-0.13px] text-text flex-1">
            Waiting for your reply
          </span>
        </div>
      )}

      {isAwaitingApproval && (
        <div className="shrink-0 px-3 py-2 bg-accent-warning/10 flex items-center gap-3 border-b border-border">
          <span className="text-[13px] text-text flex-1">
            {t('web.awaitingApproval')}
          </span>
        </div>
      )}

      {/* ── Messages ── */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={messagesRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-3 pt-4 pb-3 flex flex-col gap-4"
        >
          {fallbackMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-center">
              <div className="text-[24px] tracking-[-0.72px] opacity-30">{'\u{1F4AC}'}</div>
              <div className="text-text-dim text-[13px] tracking-[-0.13px] mt-2">
                {t('output.waitingInput') ?? 'Waiting for input...'}
              </div>
            </div>
          ) : (
            visibleMessageGroups.before.map((msg: ChatMessage, i: number) => (
              <ChatBubble
                key={`before-${i}`}
                role={msg.role}
                tool={toolName}
                timestamp={msg.timestamp}
              >
                {msg.thinking && <ThinkingBlock text={msg.thinking} />}
                {renderContent(msg.content, showToolDetails)}
              </ChatBubble>
            ))
          )}

          {/* Optimistic user message — shown immediately before stream delivers it */}
          {pendingUserMsg && !messages.some((m) => m.role === 'user' && m.content.includes(pendingUserMsg.slice(0, 30))) && (
            <ChatBubble role="user" tool={toolName}>
              {pendingUserMsg}
            </ChatBubble>
          )}

          {pendingPermission && (
            <PermissionApprovalCard
              permission={pendingPermission}
              disabled={respondToPermission.isPending}
              error={respondToPermission.error instanceof Error ? respondToPermission.error.message : undefined}
              onDecision={handlePermissionDecision}
            />
          )}

          {showInlineResolutionNotice && (
            <PermissionResolutionNotice
              label={resolvedLabel}
              continuing={isContinuingAfterPermission}
            />
          )}

          {visibleMessageGroups.after.map((msg: ChatMessage, i: number) => (
            <ChatBubble
              key={`after-${i}`}
              role={msg.role}
              tool={toolName}
              timestamp={msg.timestamp}
            >
              {msg.thinking && <ThinkingBlock text={msg.thinking} />}
              {renderContent(msg.content, showToolDetails)}
            </ChatBubble>
          ))}

          {showTerminalResolutionNotice && (
            <PermissionResolutionNotice
              label={resolvedLabel}
              continuing={false}
            />
          )}

          {/* Thinking indicator — shown only while a turn is known to be active so
              terminal permission decisions cannot leave stale processing text. */}
          {(() => {
            const lastMessage = fallbackMessages[fallbackMessages.length - 1];
            const canShowProcessing = isRunning || pendingUserMsg != null || isAwaitingApproval;
            const waitingForAssistant = pendingUserMsg != null
              || (canShowProcessing && !isTerminalPermissionResolution && fallbackMessages.length > 0 && lastMessage?.role === 'user')
              || isContinuingAfterPermission;
            if (!waitingForAssistant || isAwaitingApproval) return null;
            return (
              <div className="flex items-center gap-2 px-1 py-2">
                <span className="text-accent text-[15px] tracking-[-0.15px] status-breathe">✽</span>
                <ThinkingLabel />
              </div>
            );
          })()}

          <div ref={messagesEndRef} />

          {/* No "Generating" indicator — assistant content is visible as it streams */}
        </div>
      </div>

      {/* ── Prompt picker overlay ── */}
      {showPromptPicker && customPrompts.length > 0 && (
        <div className="shrink-0 px-3 pb-1">
          <div className="bg-surface border border-border rounded-[6px] p-2 flex flex-col gap-1.5">
            {customPrompts.map((p) => (
              <div
                key={p.id}
                className="px-3 py-2 rounded-[6px] cursor-pointer hover:bg-bg text-[13px] tracking-[-0.13px] text-text card-hover"
                onClick={() => handlePromptSelect(p.prompt)}
              >
                <span className="font-normal">{p.label}</span>
                <span className="text-text-dim text-[11px] tracking-[-0.11px] ml-1.5">
                  {p.prompt.slice(0, 40)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Toolbar row (mode + model + quick prompts inline) + Input ── */}
      <div className="shrink-0 bg-bg">
        <div className="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto">
          {modeItems.length > 0 && (() => {
            const currentMode = modeItems.find((m) => m.id === selectedMode);
            const cycleMode = () => {
              const idx = modeItems.findIndex((m) => m.id === selectedMode);
              const next = modeItems[(idx + 1) % modeItems.length];
              if (next) setSelectedMode(next.id);
            };
            return (
              <button
                type="button"
                className="shrink-0 bg-surface rounded-[6px] border border-border px-3 h-8 flex items-center gap-1.5 cursor-pointer press-spring"
                onClick={cycleMode}
              >
                <IcFeatInterfaceSettings width={14} height={14} className="text-text-dim" />
                <span className="text-[13px] tracking-[-0.13px] text-text font-normal">
                  {currentMode?.label ?? selectedMode}
                </span>
              </button>
            );
          })()}
          {modelItems.length > 0 && (() => {
            const activeModel = selectedModel || session?.model || '';
            const currentModel = modelItems.find((m) => m.id === activeModel);
            const cycleModel = () => {
              const idx = modelItems.findIndex((m) => m.id === activeModel);
              const next = modelItems[(idx + 1) % modelItems.length];
              if (next) setSelectedModel(next.id);
            };
            return (
              <button
                type="button"
                className="shrink-0 bg-surface rounded-[6px] border border-border px-3 h-8 flex items-center gap-1.5 cursor-pointer press-spring"
                onClick={cycleModel}
              >
                <IcEditSettings width={14} height={14} className="text-text-dim" />
                <span className="text-[13px] tracking-[-0.13px] text-text font-normal">
                  {currentModel?.label ?? activeModel}
                </span>
              </button>
            );
          })()}
          {!isRunning && !isAwaitingApproval && customPrompts.slice(0, 6).map((p) => (
            <button
              key={p.id}
              type="button"
              className="shrink-0 rounded-[6px] border border-border bg-surface px-3 h-8 text-[13px] tracking-[-0.13px] text-text hover:bg-bg"
              onClick={() => sendQuickPrompt(p.prompt)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="px-3 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={doSend}
            onVoiceStart={() => {}}
            onVoiceStop={isRunning ? handleCancel : undefined}
            isListening={false}
            isRunning={isRunning}
            disabled={isAwaitingApproval}
            placeholder={isAwaitingApproval ? t('web.resolvePermissionToContinue') : (t('web.sendMessage') ?? 'Type a message...')}
          />
        </div>
      </div>
    </div>
  );
}
