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
        Rising bot commits (Dependabot, Renovate, GitHub Actions) reflect growing automation infrastructure, not declining human productivity. Bot activity is normal in healthy repos.
      </HelpPanel>
    </section>
  );
}
