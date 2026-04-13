import { TrendingUp, TrendingDown } from 'lucide-react';
import { Skeleton } from '@shared/components/ui/skeleton.js';

export interface StatCalloutBoxProps {
  label: string;
  value: string;
  delta?: string;
  deltaDir?: 'up' | 'down' | 'neutral';
  isLoading?: boolean;
}

export function StatCalloutBox({ label, value, delta, deltaDir, isLoading }: StatCalloutBoxProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-1 p-4 rounded-lg border bg-card min-h-[44px]">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-8 w-16" />
      </div>
    );
  }

  const deltaColor =
    deltaDir === 'up'
      ? 'text-emerald-500'
      : deltaDir === 'down'
        ? 'text-red-500'
        : 'text-muted-foreground';

  return (
    <div className="flex flex-col gap-1 p-4 rounded-lg border bg-card min-h-[44px]">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {delta && (
        <span className={`flex items-center gap-0.5 text-xs ${deltaColor}`}>
          {deltaDir === 'up' && <TrendingUp className="h-3 w-3" />}
          {deltaDir === 'down' && <TrendingDown className="h-3 w-3" />}
          {delta}
        </span>
      )}
    </div>
  );
}
