import type { ReactNode } from 'react';

interface ChatBubbleProps {
  role: 'user' | 'assistant' | 'system';
  tool?: string;
  timestamp?: number;
  children: ReactNode;
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function providerClass(tool?: string): string {
  const t = (tool ?? '').toLowerCase();
  if (t.includes('claude')) return 'provider-claude';
  if (t.includes('codex')) return 'provider-codex';
  if (t.includes('gemini')) return 'provider-gemini';
  return '';
}

export function ChatBubble({ role, tool, timestamp, children }: ChatBubbleProps) {
  if (role === 'system') {
    return (
      <div className="bubble-system msg-enter text-[11px] tracking-[-0.11px] text-text-dim italic py-1">
        {children}
      </div>
    );
  }

  if (role === 'user') {
    return (
      <div className={`self-end max-w-[80%] msg-enter ${providerClass(tool)}`}>
        <div className="bubble-user provider-border bg-surface px-3.5 py-2.5">
          <div className="data-mono mb-1">You</div>
          <div className="text-[13px] tracking-[-0.13px] leading-relaxed whitespace-pre-wrap break-words text-text">
            {children}
          </div>
        </div>
      </div>
    );
  }

  // Assistant
  return (
    <div className={`w-full msg-enter ${providerClass(tool)}`}>
      <div className="bubble-assistant provider-border bg-surface px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          {tool && (
            <span className="data-mono uppercase">{tool}</span>
          )}
          {timestamp && (
            <span className="text-[11px] tracking-[-0.11px] text-text-dim">
              {formatTime(timestamp)}
            </span>
          )}
        </div>
        <div className="text-[13px] tracking-[-0.13px] leading-[1.7] whitespace-pre-wrap break-words text-text">
          {children}
        </div>
      </div>
    </div>
  );
}
