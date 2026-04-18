import { useState } from 'react';

interface ThinkingBlockProps {
  text: string;
  duration?: number;
}

export function ThinkingBlock({ text, duration }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const durationLabel = duration != null ? ` (${(duration / 1000).toFixed(1)}s)` : '';

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className="cursor-pointer select-none my-1.5"
    >
      <div className="text-[13px] tracking-[-0.13px] text-text-dim italic font-normal">
        {expanded ? '\u25BE' : '\u25B8'}{' '}
        {expanded ? `Thinking${durationLabel}` : 'Thinking...'}
        {!expanded && duration != null && (
          <span className="text-[11px] tracking-[-0.11px] ml-1.5">{durationLabel}</span>
        )}
      </div>

      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight: expanded ? '2000px' : '0px' }}
      >
        <div className="border-l-2 border-text-dim pl-2.5 mt-1.5 text-[13px] tracking-[-0.13px] text-text-dim italic leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
      </div>
    </div>
  );
}
