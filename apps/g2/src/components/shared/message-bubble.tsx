import { useState } from 'react';
import type { ChatMessage } from '../../types';

interface MessageBubbleProps {
  message: ChatMessage;
  showToolDetails: boolean;
}

export function MessageBubble({ message, showToolDetails }: MessageBubbleProps) {
  if (message.role === 'system') {
    return <div className="self-center text-text-dim text-[11px] tracking-[-0.11px] py-1">{message.content}</div>;
  }

  if (message.role === 'user') {
    return (
      <div className="self-end max-w-[85%] px-3.5 py-2.5 rounded-[6px] text-[13px] tracking-[-0.13px] leading-relaxed whitespace-pre-wrap break-words bg-surface border border-accent/20 text-accent">
        <div className="text-[11px] tracking-[-0.11px] text-text-dim mb-1">You</div>
        {message.content}
      </div>
    );
  }

  return (
    <div className="self-start max-w-[85%] px-3.5 py-2.5 rounded-[6px] text-[13px] tracking-[-0.13px] leading-[1.7] whitespace-pre-wrap break-words bg-surface border border-border">
      {message.thinking && <ThinkingInline text={message.thinking} />}
      <AssistantContent content={message.content} showToolDetails={showToolDetails} />
    </div>
  );
}

function ThinkingInline({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n').filter(Boolean);

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className="border-l-2 border-text-dim pl-2.5 text-text-dim italic my-2 cursor-pointer overflow-hidden"
    >
      <div className="font-normal">{lines[0] || 'Thinking...'}</div>
      {expanded && lines.length > 1 && (
        <div className="mt-2 leading-relaxed">
          {lines.slice(1).map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
      {!expanded && <span className="text-text-dim text-[11px] tracking-[-0.11px] font-normal"> [click to expand]</span>}
    </div>
  );
}

function AssistantContent({ content, showToolDetails }: { content: string; showToolDetails: boolean }) {
  if (!content.trim()) return null;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCode = false;
  let codeBlock = '';
  let key = 0;

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        elements.push(
          <pre key={key++} className="bg-black/30 px-3 py-2.5 rounded-[6px] overflow-x-auto mt-1.5 text-[11px] tracking-[-0.11px] leading-snug" style={{ fontFamily: 'var(--font-mono)' }}>
            {codeBlock}
          </pre>,
        );
        codeBlock = '';
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) { codeBlock += line + '\n'; continue; }

    if (line.startsWith('>> ')) {
      if (showToolDetails) {
        elements.push(
          <div key={key++} className="bg-accent/[0.08] border border-accent/15 rounded-[6px] px-2.5 py-2 mt-2 text-[11px] tracking-[-0.11px] text-text-dim" style={{ fontFamily: 'var(--font-mono)' }}>
            <span className="text-accent font-normal text-[11px] tracking-[-0.11px] uppercase tracking-wide">tool</span>{' '}{line.slice(3)}
          </div>,
        );
      }
      continue;
    }

    if (line.startsWith('! ')) {
      elements.push(<div key={key++} className="text-negative">{line}</div>);
      continue;
    }

    if (line.trim()) {
      elements.push(<span key={key++}>{line}<br /></span>);
    }
  }

  if (inCode) {
    elements.push(
      <pre key={key++} className="bg-black/30 px-3 py-2.5 rounded-[6px] overflow-x-auto mt-1.5 text-[11px] tracking-[-0.11px] leading-snug" style={{ fontFamily: 'var(--font-mono)' }}>
        {codeBlock}
      </pre>,
    );
  }

  return <>{elements}</>;
}
