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
import { cohortChartConfig as chartConfig } from '@shared/cohort-config.js';

type Metric = 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged' | 'totalCount';

interface CohortAreaChartProps {
  data: CohortMetricsRow[];
  metric: Metric;
  title: string;
  aiMarkerDate: string | null;
  isFetching: boolean;
}

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

  if (chartData.length === 1) {
    const pt = chartData[0];
    const total = Math.round(pt.new + pt.mid + pt.senior);
    const monthLabel = format(new Date(pt.month), 'MMM yyyy');
    return (
      <div
        className="min-h-[240px] w-full flex items-center justify-center"
        role="img"
        aria-label={title}
      >
        <p className="text-sm text-muted-foreground max-w-md text-center">
          Only one month of data ({monthLabel}: {total} total). Select a longer date range (90d+) to see trends over time.
        </p>
      </div>
    );
  }

  const aiMarkerEpoch = aiMarkerDate ? new Date(aiMarkerDate).getTime() : null;

  // Provide explicit tick values at each data point's month to avoid
  // Recharts auto-ticking showing duplicate month labels (e.g. "Feb 2026" x3)
  const monthTicks = chartData.map((d) => d.month);

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
            ticks={monthTicks}
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
