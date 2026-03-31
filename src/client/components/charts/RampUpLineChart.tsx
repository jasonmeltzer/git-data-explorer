import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@shared/components/ui/chart';
import { Skeleton } from '@shared/components/ui/skeleton';
import type { RampUpBucket } from '@shared/types.js';
import type { ChartConfig } from '@shared/components/ui/chart';

interface RampUpLineChartProps {
  data: RampUpBucket[];
  isFetching: boolean;
}

// Cohort line colors cycling through palette with lightness variation
const LINE_COLORS = [
  'var(--chart-cohort-new)',
  'var(--chart-cohort-mid)',
  'var(--chart-cohort-senior)',
  'var(--chart-ai-marker)',
  'oklch(0.60 0.18 258)',
  'oklch(0.70 0.15 145)',
  'oklch(0.65 0.16 50)',
  'oklch(0.50 0.12 300)',
];

export default function RampUpLineChart({ data, isFetching }: RampUpLineChartProps) {
  if (isFetching && data.length === 0) {
    return (
      <div className="min-h-[240px] w-full flex flex-col justify-end gap-2 p-4">
        <Skeleton className="h-[45%] w-full" />
        <Skeleton className="h-[80%] w-full" />
        <Skeleton className="h-[60%] w-full" />
      </div>
    );
  }

  // Group data by joinPeriod to determine unique periods
  const joinPeriods = [...new Set(data.map((b) => b.joinPeriod))].sort();

  if (joinPeriods.length < 2) {
    return (
      <div className="min-h-[240px] w-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground max-w-md text-center">
          Not enough data across periods to compare ramp-up. Collect more history to see this view.
        </p>
      </div>
    );
  }

  // Transform to Recharts format: array of { weekIndex, [joinPeriod]: number }
  const weekMap = new Map<number, Record<string, number>>();
  for (const bucket of data) {
    if (!weekMap.has(bucket.weekIndex)) {
      weekMap.set(bucket.weekIndex, { weekIndex: bucket.weekIndex });
    }
    weekMap.get(bucket.weekIndex)![bucket.joinPeriod] = bucket.contributionCount;
  }
  const chartData = Array.from(weekMap.values()).sort((a, b) => a.weekIndex - b.weekIndex);

  // Build chart config for each join period
  const chartConfig: ChartConfig = {};
  joinPeriods.forEach((period, i) => {
    chartConfig[period] = {
      label: period,
      color: LINE_COLORS[i % LINE_COLORS.length],
    };
  });

  return (
    <div
      className="min-h-[240px] w-full"
      role="img"
      aria-label="Line chart showing new developer ramp-up curves by join period"
    >
      <ChartContainer config={chartConfig} className="h-[350px] w-full">
        <LineChart accessibilityLayer data={chartData} margin={{ bottom: 30 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="weekIndex"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            label={{ value: 'Weeks since first commit', position: 'insideBottom', offset: -15 }}
          />
          <YAxis
            label={{ value: 'Contributions', angle: -90, position: 'insideLeft', offset: 10 }}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
          <ChartLegend content={<ChartLegendContent />} verticalAlign="top" />
          {joinPeriods.map((period, i) => (
            <Line
              key={period}
              dataKey={period}
              stroke={LINE_COLORS[i % LINE_COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  );
}
