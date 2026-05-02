import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@shared/components/ui/chart.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
import type { DeveloperMetricOption } from '@shared/lib/narratives.js';

/**
 * Phase 9.5 mini-chart primitive (D-04, D-05, D-19, D-25).
 *
 * Renders one developer's monthly time series for a single metric (PR count,
 * commit count, lines per commit, or files per commit) plus a cohort-relative
 * dashed mean line and an AI marker ReferenceLine.
 *
 * Cohort-mean line uses strokeDasharray="4 4" per D-04. connectNulls={false}
 * per D-19 so null months render as gaps (zero-commit months for lines/files).
 * AI marker ReferenceLine reads from periods[].markerDate (D-25).
 */

export interface DeveloperMiniChartDatum {
  month: string;
  value: number | null;       // The selected metric value for this dev-month
  cohortMean: number | null;  // The cohort-mean for the same month (overlay)
}

export interface DeveloperMiniChartProps {
  authorLogin: string;
  data: DeveloperMiniChartDatum[];
  metric: DeveloperMetricOption;
  aiMarkerMonth: string | null;  // 'YYYY-MM' or null if no marker
  isLoading?: boolean;
  compact?: boolean;             // true = Layout A grid (h-[140px]); false = zoom modal (h-[400px])
  onClick?: (authorLogin: string) => void;
}

export function DeveloperMiniChart({
  authorLogin,
  data,
  metric,
  aiMarkerMonth,
  isLoading = false,
  compact = true,
  onClick,
}: DeveloperMiniChartProps) {
  const heightClass = compact ? 'h-[140px]' : 'h-[400px]';

  if (isLoading && data.length === 0) {
    return <Skeleton className={`${heightClass} w-full`} />;
  }

  if (data.length === 0) {
    return (
      <div className={`${heightClass} w-full flex items-center justify-center`}>
        <p className="text-xs text-muted-foreground">No data</p>
      </div>
    );
  }

  const chartConfig = {
    value: { label: metric, color: 'var(--chart-1)' },
    cohortMean: { label: 'Cohort mean', color: 'var(--muted-foreground)' },
  };

  return (
    <div
      className={`${heightClass} w-full ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick ? () => onClick(authorLogin) : undefined}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? `Open larger view for ${authorLogin}` : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(authorLogin); } : undefined}
    >
      <ChartContainer config={chartConfig} className="h-full w-full">
        <ComposedChart data={data}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="month" hide={compact} fontSize={10} />
          <YAxis hide={compact} fontSize={10} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar
            dataKey="value"
            fill="var(--chart-1)"
            radius={[2, 2, 0, 0]}
            maxBarSize={compact ? 24 : 48}
          />
          <Line
            type="monotone"
            dataKey="cohortMean"
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
            name="Cohort mean"
          />
          {aiMarkerMonth && (
            <ReferenceLine
              x={aiMarkerMonth}
              stroke="var(--chart-ai-marker)"
              strokeDasharray="4 4"
              strokeWidth={2}
              label={!compact ? ({ viewBox }) => {
                if (!viewBox || typeof (viewBox as { x?: number }).x !== 'number') return null;
                const { x: cx } = viewBox as { x: number };
                return (
                  <text x={cx + 4} y={16} fontSize={11} fill="var(--muted-foreground)">
                    AI tools adopted
                  </text>
                );
              } : undefined}
            />
          )}
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
