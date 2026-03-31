import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@shared/components/ui/card';
import { Skeleton } from '@shared/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import type { RollingComparisonResult } from '@shared/types.js';

interface RollingCardsProps {
  data: RollingComparisonResult | undefined;
  isFetching: boolean;
  granularity: 'month' | 'quarter';
  onGranularityChange: (g: 'month' | 'quarter') => void;
}

interface MetricCardData {
  label: string;
  value: number | undefined;
  change: number | null | undefined;
  unit?: string;
  isVolume: boolean; // for color direction: volume up = green, size changes neutral
}

function ChangeIndicator({ change, isVolume }: { change: number | null | undefined; isVolume: boolean }) {
  if (change === null || change === undefined) {
    return <span className="text-muted-foreground text-sm">N/A</span>;
  }
  const isPositive = change >= 0;
  const pct = Math.abs(Math.round(change));
  const positiveClass = isVolume ? 'text-emerald-500' : 'text-muted-foreground';
  const negativeClass = isVolume ? 'text-red-500' : 'text-muted-foreground';
  const colorClass = isPositive ? positiveClass : negativeClass;

  return (
    <span className={`flex items-center gap-1 text-sm font-medium ${colorClass}`}>
      {isPositive ? (
        <TrendingUp className="h-4 w-4" />
      ) : change === 0 ? (
        <Minus className="h-4 w-4" />
      ) : (
        <TrendingDown className="h-4 w-4" />
      )}
      {pct}%
    </span>
  );
}

export default function RollingCards({
  data,
  isFetching,
  granularity,
  onGranularityChange,
}: RollingCardsProps) {
  const cards: MetricCardData[] = [
    {
      label: 'PR Count',
      value: data?.current.prCount,
      change: data?.changes.prFrequency,
      isVolume: true,
    },
    {
      label: 'Commit Count',
      value: data?.current.commitCount,
      change: data?.changes.commitFrequency,
      isVolume: true,
    },
    {
      label: 'Avg PR Size',
      value: data?.current.avgPrSize != null ? Math.round(data.current.avgPrSize) : undefined,
      change: data?.changes.prSize,
      unit: 'lines',
      isVolume: false,
    },
    {
      label: 'Avg Commit Size',
      value: data?.current.avgCommitSize != null ? Math.round(data.current.avgCommitSize) : undefined,
      change: data?.changes.commitSize,
      unit: 'lines',
      isVolume: false,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Tabs value={granularity} onValueChange={(v) => onGranularityChange(v as 'month' | 'quarter')}>
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="quarter">Quarter</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {data && (
        <p className="text-xs text-muted-foreground">
          {data.current.label} vs {data.prior.label}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isFetching && card.value === undefined ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ) : (
                <>
                  <div className="text-[28px] font-semibold leading-none mb-2">
                    {card.value !== undefined
                      ? card.value.toLocaleString()
                      : '—'}
                    {card.unit && card.value !== undefined && (
                      <span className="text-sm font-normal text-muted-foreground ml-1">
                        {card.unit}
                      </span>
                    )}
                  </div>
                  <ChangeIndicator change={card.change} isVolume={card.isVolume} />
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
