import { cn } from 'even-toolkit/web/cn';

interface CodeBlockProps {
  content: string;
  diff?: boolean;
}

export function CodeBlock({ content, diff }: CodeBlockProps) {
  const lines = content.split('\n');

  return (
    <div className="bg-black/30 border border-border rounded-[6px] overflow-auto font-[family-name:var(--font-mono)] text-[11px] tracking-[-0.11px] leading-relaxed">
      {lines.map((line, i) => {
        let cls = '';
        if (diff) {
          if (line.startsWith('+') && !line.startsWith('+++')) cls = 'bg-positive/[0.08] [&_.line-content]:text-positive';
          else if (line.startsWith('-') && !line.startsWith('---')) cls = 'bg-negative/[0.08] [&_.line-content]:text-negative';
          else if (line.startsWith('@@')) cls = 'bg-accent/[0.06] [&_.line-content]:text-accent';
        }

        return (
          <div key={i} className={cn('flex px-3 min-h-[20px]', cls)}>
            <span className="w-10 text-right pr-3 text-text-dim select-none shrink-0">{i + 1}</span>
            <span className="line-content flex-1 whitespace-pre">{line}</span>
          </div>
        );
      })}
    </div>
  );
}
