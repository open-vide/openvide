import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { Select } from 'even-toolkit/web';
import { ProviderBadge } from '../components/chat/provider-badge';
import { ChatBubble } from '../components/chat/chat-bubble';
import { ChatInput } from '../components/chat/chat-input';
import { rpc } from '../domain/daemon-client';
import { usePullRefresh } from '../hooks/use-pull-refresh';

interface TeamMessageSummary {
  id: string;
  from: string;
  fromTool?: string;
  to: string;
  text: string;
  createdAt: string;
}

function formatRecipient(to: string): string {
  if (to === '*' || to === 'team') return 'team';
  if (to === 'user' || to === 'you') return 'you';
  return to;
}

function sameMessages(a: TeamMessageSummary[], b: TeamMessageSummary[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (
      left.id !== right.id
      || left.from !== right.from
      || left.to !== right.to
      || left.text !== right.text
      || left.createdAt !== right.createdAt
      || left.fromTool !== right.fromTool
    ) {
      return false;
    }
  }
  return true;
}

export function TeamChatRoute() {
  const [params] = useSearchParams();
  const teamId = params.get('id') ?? '';
  const [messages, setMessages] = useState<TeamMessageSummary[]>([]);
  const [recipient, setRecipient] = useState('*');
  const [recipients, setRecipients] = useState<Array<{ value: string; label: string }>>([{ value: '*', label: 'Team' }]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      const res = await rpc('team.message.list', { teamId, limit: 50 });
      if (res.ok && Array.isArray(res.teamMessages)) {
        const nextMessages = res.teamMessages as TeamMessageSummary[];
        setMessages((current) => (sameMessages(current, nextMessages) ? current : nextMessages));
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    if (!teamId) return;
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [teamId]);

  useEffect(() => {
    if (!teamId) return;
    rpc('team.get', { teamId }).then((res) => {
      if (!res.ok || !res.team) return;
      const team = res.team as { members?: Array<{ name: string }> };
      const next = [{ value: '*', label: 'Team' }];
      for (const member of team.members ?? []) {
        next.push({ value: member.name, label: member.name });
      }
      setRecipients(next);
    }).catch(() => {});
  }, [teamId]);

  useEffect(() => {
    if (!autoScroll) return;
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [autoScroll, messages]);

  const handleSend = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await rpc('team.message.send', { teamId, to: recipient, text: draft.trim() });
      setDraft('');
      await refresh();
    } catch { /* ignore */ }
    setSending(false);
  };

  const { pullHandlers, PullIndicator } = usePullRefresh(refresh);

  const AI_TOOLS = ['claude', 'codex', 'gemini'];
  const isUserMessage = (msg: TeamMessageSummary) => {
    if (msg.from === 'user' || msg.from === 'you') return true;
    if (msg.fromTool && AI_TOOLS.includes(msg.fromTool)) return false;
    // Infer from sender name: if it matches a known AI tool, treat as AI
    if (AI_TOOLS.includes(msg.from.toLowerCase())) return false;
    // Default: messages without fromTool from unknown senders are user messages
    return !msg.fromTool;
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceFromBottom < 80);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-4 flex flex-col gap-4"
        {...pullHandlers}
      >
        <PullIndicator />
        {loading && (
          <p className="text-[13px] tracking-[-0.13px] text-text-dim text-center py-6 status-breathe-fast">Loading...</p>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center py-15 text-center text-text-dim">
            <div className="text-[40px] mb-4 opacity-30">{'\u{1F4AC}'}</div>
            <div className="text-[15px] tracking-[-0.15px] font-normal text-text mb-1.5">No messages yet</div>
            <div className="text-[13px] tracking-[-0.13px]">Start the conversation with your team</div>
          </div>
        )}

        {messages.map((msg) => {
          const isUser = isUserMessage(msg);
          return (
            <div key={msg.id} className={`msg-enter flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
              {!isUser && (
                <div className="flex items-center gap-1.5 mb-1 ml-1">
                  <ProviderBadge provider={(msg.fromTool || 'claude') as 'claude' | 'codex' | 'gemini'} size={18} />
                  <span className="data-mono">{msg.from}</span>
                  <span className="text-[11px] tracking-[-0.11px] text-text-dim">{'\u2192'} {formatRecipient(msg.to)}</span>
                </div>
              )}
              <ChatBubble
                role={isUser ? 'user' : 'assistant'}
                tool={msg.fromTool || msg.from}
                timestamp={new Date(msg.createdAt).getTime()}
              >
                {msg.text}
              </ChatBubble>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 px-3 pb-3 pt-2 border-t border-border bg-bg">
        <div className="mb-2">
          <Select value={recipient} options={recipients} onValueChange={setRecipient} dropdownPosition="top" />
        </div>
        <ChatInput
          value={draft}
          onChange={setDraft}
          onSend={handleSend}
          isRunning={sending}
          placeholder="Type a message to the team..."
        />
      </div>
    </div>
  );
}
