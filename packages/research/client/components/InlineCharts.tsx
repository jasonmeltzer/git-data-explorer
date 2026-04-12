/**
 * Inline chart components using bare Recharts + ResponsiveContainer.
 * Bypasses shadcn ChartContainer which has sizing issues (aspect-video + flex).
 */

import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { format } from 'date-fns';
import { cohortRowsToChartData } from '@shared/lib/chartTransforms.js';
import type { CohortMetricsRow, RampUpBucket } from '@shared/types.js';

type CommitMetric = 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged' | 'totalCount';

const COHORT_COLORS = {
  new: 'var(--chart-cohort-new, #4a90d9)',
  mid: 'var(--chart-cohort-mid, #82b366)',
  senior: 'var(--chart-cohort-senior, #d9a441)',
};

const LINE_COLORS = ['#4a90d9', '#82b366', '#d9a441', '#8b5cf6', '#ef4444', '#06b6d4'];

export function InlineCohortChart({ data, metric, aiMarkerDate }: {
  data: CohortMetricsRow[];
  metric: CommitMetric;
  aiMarkerDate: string | null;
}) {
  const chartData = cohortRowsToChartData(data, metric);
  if (chartData.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No data available.</p>;
  }
  const aiEpoch = aiMarkerDate ? new Date(aiMarkerDate).getTime() : null;

  return (
    <div style={{ width: '100%', height: 350 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v: number) => format(new Date(v), 'MMM yyyy')}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={12}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
          <Tooltip
            labelFormatter={(v: number) => format(new Date(v), 'MMM yyyy')}
            formatter={(value: number, name: string) => [Math.round(value), name]}
          />
          <Legend />
          {aiEpoch && (
            <ReferenceLine x={aiEpoch} stroke="var(--chart-ai-marker, #8b5cf6)" strokeDasharray="6 3" strokeWidth={2} />
          )}
          <Area dataKey="senior" stackId="cohort" fill={COHORT_COLORS.senior} stroke={COHORT_COLORS.senior} fillOpacity={0.6} name="Senior (1yr+)" />
          <Area dataKey="mid" stackId="cohort" fill={COHORT_COLORS.mid} stroke={COHORT_COLORS.mid} fillOpacity={0.6} name="Growing (3-12mo)" />
          <Area dataKey="new" stackId="cohort" fill={COHORT_COLORS.new} stroke={COHORT_COLORS.new} fillOpacity={0.6} name="New (0-3mo)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function InlineRampUpChart({ data }: { data: RampUpBucket[] }) {
  const periods = [...new Set(data.map(d => d.joinPeriod))].sort();
  if (periods.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No ramp-up data available.</p>;
  }

  const byWeek = new Map<number, Record<string, number>>();
  for (const row of data) {
    if (!byWeek.has(row.weekIndex)) byWeek.set(row.weekIndex, { weekIndex: row.weekIndex });
    byWeek.get(row.weekIndex)![row.joinPeriod] = row.avgLinesChanged;
  }
  const chartData = Array.from(byWeek.values()).sort((a, b) => (a.weekIndex as number) - (b.weekIndex as number));

  return (
    <div style={{ width: '100%', height: 350 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="weekIndex" tickFormatter={(v: number) => `W${v}`} fontSize={12} />
          <YAxis fontSize={12} />
          <Tooltip />
          <Legend />
          {periods.map((p, i) => (
            <Line key={p} dataKey={p} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} name={p} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
