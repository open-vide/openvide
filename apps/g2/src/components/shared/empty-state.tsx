import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-15 px-3 text-center text-text-dim">
      <div className="mb-4 text-text-dim opacity-50">{icon}</div>
      <div className="text-[15px] tracking-[-0.15px] font-normal text-text mb-1.5">{title}</div>
      <div className="text-[13px] mb-4">{description}</div>
    </div>
  );
}
