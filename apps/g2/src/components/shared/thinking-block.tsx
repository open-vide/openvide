import { useState } from 'react';
import { cn } from 'even-toolkit/web/cn';

interface ThinkingBlockProps {
  thinking: string;
}

export function ThinkingBlock({ thinking }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = thinking.split('\n').filter(Boolean);
  const preview = lines[0] ?? 'Thinking...';
  const body = lines.slice(1);

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className={cn(
        'border-l-2 border-text-dim pl-2.5 text-text-dim italic my-2 cursor-pointer overflow-hidden',
        !expanded && 'line-clamp-1',
      )}
    >
      <div className="font-normal">{preview}</div>
      {expanded && body.length > 0 && (
        <div className="mt-2 leading-relaxed">
          {body.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      {!expanded && (
        <span className="text-text-dim text-[11px] font-normal"> [click to expand]</span>
      )}
    </div>
  );
}
