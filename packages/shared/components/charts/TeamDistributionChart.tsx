import {
  ComposedChart,
  Bar,
  Line,
  Cell,
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
import type { ConcentrationMonthlyRow } from '@shared/types.js';

interface TeamDistributionChartProps {
  data: ConcentrationMonthlyRow[];
  aiMarkerDate: string | null;
  isLoading: boolean;
}

const chartConfig = {
  top1Share: {
    label: 'Top-1 Share %',
    color: 'var(--chart-concentration)',
  },
  hhi: {
    label: 'HHI',
    color: 'var(--chart-hhi-line)',
  },
};

export function getBarFill(top1Share: number | null): string {
  if (top1Share == null) return 'var(--chart-concentration)';
  if (top1Share >= 60) return 'oklch(0.577 0.245 27.325)'; // red (reuse --destructive light)
  if (top1Share >= 50) return 'oklch(0.75 0.15 85)';       // amber
  return 'var(--chart-concentration)';                       // purple
}

export function TeamDistributionChart({ data, aiMarkerDate, isLoading }: TeamDistributionChartProps) {
  if (isLoading && data.length === 0) {
    return <Skeleton className="h-[300px] w-full" />;
  }

  if (data.length === 0) {
    return (
      <div className="h-[300px] w-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No concentration data available for this period.
        </p>
      </div>
    );
  }

  // Derive AI marker month string (YYYY-MM) for x-axis reference
  const aiMarkerMonth = aiMarkerDate
    ? aiMarkerDate.slice(0, 7)
    : null;

  return (
    <div className="w-full" role="img" aria-label="Concentration risk chart">
      <ChartContainer config={chartConfig} className="h-[300px] w-full">
        <ComposedChart accessibilityLayer data={data}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            yAxisId="share"
            orientation="left"
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis
            yAxisId="hhi"
            orientation="right"
            domain={[0, 1]}
            label={{ value: 'HHI', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 11 } }}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          {/* 50% danger zone reference line */}
          <ReferenceLine
            yAxisId="share"
            y={50}
            stroke="oklch(0.75 0.15 85)"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{ value: '50%', position: 'insideTopLeft', fontSize: 10, fill: 'oklch(0.75 0.15 85)' }}
          />
          {/* AI adoption marker */}
          {aiMarkerMonth && (
            <ReferenceLine
              yAxisId="share"
              x={aiMarkerMonth}
              stroke="var(--chart-ai-marker)"
              strokeDasharray="4 4"
              strokeWidth={2}
              label={({ viewBox }) => {
                // Recharts 3.x can invoke this render function with an undefined
                // viewBox during early mount cycles. Skip rendering the label
                // rather than throwing on a missing x coordinate.
                if (!viewBox || typeof (viewBox as { x?: number }).x !== 'number') return null;
                const { x: cx } = viewBox as { x: number };
                return (
                  <text x={cx + 4} y={16} fontSize={11} fill="var(--muted-foreground)">
                    AI tools adopted
                  </text>
                );
              }}
            />
          )}
          <Bar
            yAxisId="share"
            dataKey="top1Share"
            radius={[4, 4, 0, 0]}
            name="Top-1 Share %"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBarFill(entry.top1Share)} />
            ))}
          </Bar>
          <Line
            yAxisId="hhi"
            type="monotone"
            dataKey="hhi"
            stroke="var(--chart-hhi-line)"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
            name="HHI"
          />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
