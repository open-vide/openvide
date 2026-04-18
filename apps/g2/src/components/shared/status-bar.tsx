import { StatusDot } from './status-dot';
import { Badge } from 'even-toolkit/web';

interface StatusBarProps {
  connectionStatus: string;
  sessionCount: number;
  runningCount: number;
  pendingCount: number;
}

export function StatusBar({ connectionStatus, sessionCount, runningCount, pendingCount }: StatusBarProps) {
  const isConnected = connectionStatus === 'connected';

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-surface border-b border-border">
      <div className="flex items-center gap-1.5">
        <StatusDot status={isConnected ? 'connected' : 'disconnected'} />
        <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="data-mono">{sessionCount}</span>
        <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">sessions</span>
      </div>

      {runningCount > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-positive status-breathe" />
          <span className="data-mono">{runningCount}</span>
          <span className="text-[11px] tracking-[-0.11px] text-text-dim font-normal">running</span>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="ml-auto">
          <Badge variant="negative">{pendingCount} pending</Badge>
        </div>
      )}
    </div>
  );
}
