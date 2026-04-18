import { useState, useCallback } from 'react';

interface CodeBlockProps {
  code: string;
  language?: string;
  diff?: boolean;
}

export function CodeBlock({ code, language, diff }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  const lines = code.replace(/\n$/, '').split('\n');

  return (
    <div className="code-surface my-1.5">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
        {language ? (
          <span className="text-[11px] tracking-[-0.11px] uppercase" style={{ color: '#777' }}>
            {language}
          </span>
        ) : (
          <span />
        )}
        <button
          onClick={handleCopy}
          className={`text-[11px] tracking-[-0.11px] cursor-pointer bg-transparent border-none ${copied ? 'copy-flash' : ''}`}
          style={{ color: copied ? 'var(--color-positive)' : '#777' }}
        >
          {copied ? '\u2713 Copied' : 'Copy'}
        </button>
      </div>

      {/* Code lines */}
      <div className="px-3 py-2 overflow-x-auto">
        {lines.map((line, i) => {
          let lineClass = '';
          if (diff) {
            if (line.startsWith('+')) lineClass = 'line-added';
            else if (line.startsWith('-')) lineClass = 'line-removed';
            else if (line.startsWith('@@')) lineClass = 'line-meta';
          }

          return (
            <div key={i} className={`flex ${lineClass}`}>
              <span className="line-num">{i + 1}</span>
              <span className="flex-1 whitespace-pre">{line}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
