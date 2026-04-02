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
import { useBotRatio } from '../../hooks/useBotRatio.js';
import { computeBotRatioInsights } from '../../lib/insights.js';
import { SectionHeader } from '../SectionHeader.js';
import { HelpPanel } from '../HelpPanel.js';
import { StatCalloutRow } from './StatCalloutRow.js';
import { StatCalloutBox } from './StatCalloutBox.js';
import NarrativeCard from './NarrativeCard.js';

interface BotRatioChartProps {
  startDate: string;
  endDate: string;
  repoIds: number[];
}

const chartConfig = {
  botPercentage: {
    label: 'Bot Commit %',
    color: 'var(--chart-2)',
  },
};

export function BotRatioChart({ startDate, endDate, repoIds }: BotRatioChartProps) {
  const { data = [], isFetching } = useBotRatio({ startDate, endDate, repoIds });

  const insights = computeBotRatioInsights(data);

  const narrativeText = data.length > 0
    ? `Bot contribution trend across ${data.length} month${data.length !== 1 ? 's' : ''}. ${
        insights[2]?.value !== '--' ? `${insights[2].value} trend in bot activity.` : ''
      }`
    : '';

  return (
    <section>
      <SectionHeader title="Bot vs Human Contributions" scope="filtered" />
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
              No commit data available for this period.
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
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => `${Math.round(Number(value))}%`}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="botPercentage"
                stroke="var(--chart-2)"
                strokeWidth={2}
                dot={{ r: 4, fill: 'var(--chart-2)' }}
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
          This chart shows the percentage of total commits attributed to bots
          (Dependabot, Renovate, GitHub Actions, and similar accounts) versus human
          contributors over time. A rising bot ratio may reflect increasing adoption
          of automated dependency management or CI/CD pipelines — not a problem, but
          context that helps you read the human-contributor charts accurately.
        </p>
        <p className="mt-2">
          Bot commits are excluded from all cohort and ramp-up analysis. If your bot
          ratio spikes unexpectedly, check whether a new automation was introduced
          around that time. A consistently high bot ratio (over 30%) may indicate your
          collection window captures a lot of infrastructure repos — consider filtering
          to application repos for cleaner contributor analysis.
        </p>
        <p className="mt-2">
          This view counts commit events, not code volume. A bot that opens many small
          dependency bumps will appear more dominant than its actual code contribution.
        </p>
      </HelpPanel>
    </section>
  );
}
