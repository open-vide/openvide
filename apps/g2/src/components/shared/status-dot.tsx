import { cn } from 'even-toolkit/web/cn';

const statusColors: Record<string, string> = {
  idle: 'bg-text-dim',
  running: 'bg-accent animate-pulse-status',
  failed: 'bg-negative',
  cancelled: 'bg-accent-warning',
  interrupted: 'bg-accent-warning',
  connected: 'bg-positive',
  disconnected: 'bg-negative',
  connecting: 'bg-accent-warning animate-pulse-fast',
};

interface StatusDotProps {
  status?: string;
  className?: string;
}

export function StatusDot({ status = 'idle', className }: StatusDotProps) {
  return <span className={cn('inline-block w-2 h-2 rounded-full shrink-0', statusColors[status] ?? 'bg-text-dim', className)} />;
}
