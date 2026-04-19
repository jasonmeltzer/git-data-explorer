import {
  BarChart,
  Bar,
  ComposedChart,
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
import type { HeadcountMonthlyRow } from '@shared/types.js';

interface ScaryRealPanelProps {
  data: HeadcountMonthlyRow[];
  aiMarkerDate: string | null;
  isLoading: boolean;
}

const totalPrsConfig = {
  totalPrs: {
    label: 'Total PRs',
    color: 'var(--chart-concentration)',
  },
};

const prsPerDevConfig = {
  activeDevs: {
    label: 'Active Devs',
    color: 'var(--chart-headcount)',
  },
  prsPerDev: {
    label: 'PRs / Developer',
    color: 'var(--chart-hhi-line)',
  },
};

export function ScaryRealPanel({ data, aiMarkerDate, isLoading }: ScaryRealPanelProps) {
  if (isLoading && data.length === 0) {
    return <Skeleton className="h-[300px] w-full" />;
  }

  if (data.length === 0) {
    return (
      <div className="h-[300px] w-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No team size data available for this period. Ensure at least one tracked repo has completed data collection.
        </p>
      </div>
    );
  }

  // Derive AI marker month string (YYYY-MM) for x-axis reference
  const aiMarkerMonth = aiMarkerDate ? aiMarkerDate.slice(0, 7) : null;

  return (
    <div className="flex flex-col md:flex-row gap-4">
      {/* Left panel: Total PRs */}
      <div className="flex-1">
        <p className="text-xs text-muted-foreground text-center mb-1">Total PRs</p>
        <ChartContainer config={totalPrsConfig} className="h-[300px] w-full">
          <BarChart accessibilityLayer data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tick={{ fontSize: 11 }}
            />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {aiMarkerMonth && (
              <ReferenceLine
                x={aiMarkerMonth}
                stroke="var(--chart-ai-marker)"
                strokeDasharray="4 4"
                strokeWidth={2}
              />
            )}
            <Bar
              dataKey="totalPrs"
              fill="var(--chart-concentration)"
              radius={[4, 4, 0, 0]}
              name="Total PRs"
            />
          </BarChart>
        </ChartContainer>
      </div>

      {/* Right panel: PRs / Developer */}
      <div className="flex-1">
        <p className="text-xs text-muted-foreground text-center mb-1">PRs / Developer</p>
        <ChartContainer config={prsPerDevConfig} className="h-[300px] w-full">
          <ComposedChart accessibilityLayer data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tick={{ fontSize: 11 }}
            />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {aiMarkerMonth && (
              <ReferenceLine
                x={aiMarkerMonth}
                stroke="var(--chart-ai-marker)"
                strokeDasharray="4 4"
                strokeWidth={2}
              />
            )}
            <Bar
              dataKey="activeDevs"
              fill="var(--chart-headcount)"
              fillOpacity={0.3}
              radius={[4, 4, 0, 0]}
              name="Active Devs"
            />
            <Line
              type="monotone"
              dataKey="prsPerDev"
              stroke="var(--chart-hhi-line)"
              strokeWidth={3}
              dot={{ r: 4 }}
              connectNulls={false}
              name="PRs / Developer"
            />
          </ComposedChart>
        </ChartContainer>
      </div>
    </div>
  );
}
