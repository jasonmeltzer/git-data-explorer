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
} from '@shared/components/ui/chart.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
import { usePrTurnaround } from '../../hooks/usePrTurnaround.js';
import { computePrTurnaroundInsights } from '../../lib/insights.js';
import { SectionHeader } from '../SectionHeader.js';
import { HelpPanel } from '../HelpPanel.js';
import { StatCalloutRow } from './StatCalloutRow.js';
import { StatCalloutBox } from './StatCalloutBox.js';
import NarrativeCard from './NarrativeCard.js';

interface PrTurnaroundChartProps {
  startDate: string;
  endDate: string;
  repoIds: number[];
}

const chartConfig = {
  avgHoursToMerge: {
    label: 'Avg Hours to Merge',
    color: 'var(--chart-1)',
  },
};

export function PrTurnaroundChart({ startDate, endDate, repoIds }: PrTurnaroundChartProps) {
  const { data = [], isFetching } = usePrTurnaround({ startDate, endDate, repoIds });

  const insights = computePrTurnaroundInsights(data);

  const narrativeText = data.length > 0
    ? `Showing PR review turnaround across ${data.length} month${data.length !== 1 ? 's' : ''}. ${
        insights[2]?.value !== '--' ? `Trend: ${insights[2].value}.` : ''
      }`
    : '';

  return (
    <section>
      <SectionHeader title="PR Review Turnaround" scope="filtered" />
      <div className="mt-4">
        <StatCalloutRow>
          {insights.map((insight) => (
            <StatCalloutBox
              key={insight.label}
              label={insight.label}
              value={insight.value}
              delta={insight.delta}
              deltaDir={insight.deltaDir}
              isLoading={isFetching && data.length === 0}
            />
          ))}
        </StatCalloutRow>
      </div>

      <div className="mt-4">
        {isFetching && data.length === 0 ? (
          <div className="min-h-[240px] w-full flex flex-col justify-end gap-2 p-4">
            <Skeleton className="h-[60%] w-full" />
            <Skeleton className="h-[80%] w-full" />
            <Skeleton className="h-[50%] w-full" />
          </div>
        ) : data.length === 0 ? (
          <div className="min-h-[240px] w-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Not enough merged PRs in this range to calculate a reliable median.
            </p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <LineChart accessibilityLayer data={data}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="periodMonth"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v: number) => v < 24 ? `${v}h` : `${(v / 24).toFixed(1)}d`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => {
                      const hours = Number(value);
                      return hours < 24 ? `${Math.round(hours)}h` : `${(hours / 24).toFixed(1)}d`;
                    }}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="avgHoursToMerge"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={{ r: 4, fill: 'var(--chart-1)' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </div>

      {narrativeText && (
        <NarrativeCard text={narrativeText} isFetching={isFetching && data.length === 0} />
      )}

      <HelpPanel>
        <p>
          This chart shows how the average time from PR creation to merge has changed
          over time. Each data point is the average hours-to-merge for PRs opened in
          that month. Lower values mean PRs are being merged more quickly.
        </p>
        <p className="mt-2">
          Faster turnaround can reflect smaller PRs (easier to review), better review
          culture, or AI-assisted code review tooling. If you see a step-change
          downward after your AI adoption date, that is worth investigating as a
          productivity signal. If turnaround time is increasing, it may indicate that
          PR sizes are growing faster than review capacity can keep up.
        </p>
        <p className="mt-2">
          This metric uses the median review time per month to reduce distortion from
          very large or very old PRs. Repos without complete PR data will affect the
          accuracy of this chart — check the Collection tab for completeness status.
        </p>
      </HelpPanel>
    </section>
  );
}
