import { format } from 'date-fns';
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@shared/components/ui/chart';
import { Skeleton } from '@shared/components/ui/skeleton';
import { cohortRowsToChartData } from '../../lib/chartTransforms';
import type { CohortMetricsRow } from '@shared/types.js';

type Metric = 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged' | 'totalCount';

interface CohortAreaChartProps {
  data: CohortMetricsRow[];
  metric: Metric;
  title: string;
  aiMarkerDate: string | null;
  isFetching: boolean;
}

const chartConfig = {
  senior: { label: 'Senior (1yr+)', color: 'var(--chart-cohort-senior)' },
  mid: { label: 'Growing (3-12mo)', color: 'var(--chart-cohort-mid)' },
  new: { label: 'New (0-3mo)', color: 'var(--chart-cohort-new)' },
};

export default function CohortAreaChart({
  data,
  metric,
  title,
  aiMarkerDate,
  isFetching,
}: CohortAreaChartProps) {
  const chartData = cohortRowsToChartData(data, metric);

  if (isFetching && data.length === 0) {
    return (
      <div
        className="min-h-[240px] w-full flex flex-col justify-end gap-2 p-4"
        role="img"
        aria-label={`Loading ${title}`}
      >
        <Skeleton className="h-[45%] w-full" />
        <Skeleton className="h-[80%] w-full" />
        <Skeleton className="h-[60%] w-full" />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div
        className="min-h-[240px] w-full flex items-center justify-center"
        role="img"
        aria-label={title}
      >
        <p className="text-sm text-muted-foreground">No data available for this period.</p>
      </div>
    );
  }

  const aiMarkerEpoch = aiMarkerDate ? new Date(aiMarkerDate).getTime() : null;

  return (
    <div
      className="min-h-[240px] w-full"
      role="img"
      aria-label={`Stacked area chart: ${title}`}
    >
      <ChartContainer config={chartConfig} className="h-[350px] w-full">
        <AreaChart accessibilityLayer data={chartData}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="month"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v: number) => format(new Date(v), 'MMM yyyy')}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} />
          {aiMarkerEpoch !== null && (
            <ReferenceLine
              x={aiMarkerEpoch}
              stroke="var(--chart-ai-marker)"
              strokeDasharray="6 3"
              strokeWidth={2}
              strokeOpacity={0.85}
              label={({ viewBox }) => {
                const { x: cx } = viewBox as { x: number };
                return (
                  <text x={cx + 4} y={16} fontSize={11} fill="var(--muted-foreground)">
                    AI tools adopted
                  </text>
                );
              }}
            />
          )}
          <Area
            dataKey="senior"
            stackId="cohort"
            fill="var(--chart-cohort-senior)"
            stroke="var(--chart-cohort-senior)"
            fillOpacity={0.6}
          />
          <Area
            dataKey="mid"
            stackId="cohort"
            fill="var(--chart-cohort-mid)"
            stroke="var(--chart-cohort-mid)"
            fillOpacity={0.6}
          />
          <Area
            dataKey="new"
            stackId="cohort"
            fill="var(--chart-cohort-new)"
            stroke="var(--chart-cohort-new)"
            fillOpacity={0.6}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
