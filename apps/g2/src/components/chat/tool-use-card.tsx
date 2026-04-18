import { useState } from 'react';

const TOOL_LABELS: Record<string, string> = {
  'Bash': 'Terminal',
  'Read': 'Read file',
  'Write': 'Write file',
  'Edit': 'Edit file',
  'Glob': 'Search files',
  'Grep': 'Search content',
  'LSP': 'Code analysis',
  'WebFetch': 'Fetch URL',
  'WebSearch': 'Web search',
  'Agent': 'Sub-agent',
  'NotebookEdit': 'Edit notebook',
};

function friendlyToolName(raw: string): string {
  return TOOL_LABELS[raw] ?? raw;
}

interface ToolUseCardProps {
  name: string;
  input?: string;
  status?: 'running' | 'done' | 'error';
}

export function ToolUseCard({ name, input, status = 'done' }: ToolUseCardProps) {
  const [expanded, setExpanded] = useState(false);

  const statusIndicator =
    status === 'running' ? (
      <span className="text-text-dim status-breathe">{'\u25CF'}</span>
    ) : status === 'error' ? (
      <span className="text-negative">{'\u2717'}</span>
    ) : (
      <span className="text-positive">{'\u2713'}</span>
    );

  return (
    <div
      className={`bg-surface-light rounded-[6px] my-1 overflow-hidden ${status === 'running' ? 'shimmer-bg' : ''}`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-1.5 px-3 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[11px] tracking-[-0.11px] text-text-dim">{'\u25B8'}</span>
        <span className="data-mono flex-1 truncate">{friendlyToolName(name)}</span>
        {statusIndicator}
      </div>

      {/* Expanded content */}
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight: expanded ? '400px' : '0px' }}
      >
        {input && (
          <div className="code-surface mx-2 mb-2 px-3 py-2 text-[11px] tracking-[-0.11px] whitespace-pre-wrap overflow-x-auto">
            {input}
          </div>
        )}
      </div>
    </div>
  );
}
