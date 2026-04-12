import { useState } from 'react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { format } from 'date-fns';
import { Badge } from '@shared/components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
import { StatCalloutBox } from '@shared/components/charts/StatCalloutBox.js';
import { cohortRowsToChartData } from '@shared/lib/chartTransforms.js';
import SnapshotHistory from '../components/SnapshotHistory.js';
import { useOrg } from '../hooks/useOrgs.js';
import { useSnapshotData } from '../hooks/useSnapshotData.js';
import type { CohortMetricsRow, RampUpBucket } from '@shared/types.js';

interface OrgDashboardProps {
  orgId: number;
}

type CommitMetric = 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged' | 'totalCount';

const COHORT_COLORS = {
  new: 'var(--chart-cohort-new, #4a90d9)',
  mid: 'var(--chart-cohort-mid, #82b366)',
  senior: 'var(--chart-cohort-senior, #d9a441)',
};

function InlineCohortChart({ data, metric, aiMarkerDate }: {
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

function InlineRampUpChart({ data }: { data: RampUpBucket[] }) {
  // Group by joinPeriod, show avgLinesChanged by weekIndex
  const periods = [...new Set(data.map(d => d.joinPeriod))].sort();
  if (periods.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No ramp-up data available.</p>;
  }

  // Pivot: each weekIndex row has a column per joinPeriod
  const byWeek = new Map<number, Record<string, number>>();
  for (const row of data) {
    if (!byWeek.has(row.weekIndex)) byWeek.set(row.weekIndex, { weekIndex: row.weekIndex });
    byWeek.get(row.weekIndex)![row.joinPeriod] = row.avgLinesChanged;
  }
  const chartData = Array.from(byWeek.values()).sort((a, b) => (a.weekIndex as number) - (b.weekIndex as number));
  const colors = ['#4a90d9', '#82b366', '#d9a441', '#d94a4a'];

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
            <Line key={p} dataKey={p} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} name={p} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function OrgDashboard({ orgId }: OrgDashboardProps) {
  const { data: org, isLoading: orgLoading } = useOrg(orgId);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [commitMetric, setCommitMetric] = useState<CommitMetric>('avgLinesAdded');

  const snapshotId = selectedSnapshotId ?? (org?.snapshots?.[0]?.id ?? null);
  const { data: bundle, isFetching: dataFetching } = useSnapshotData(orgId, snapshotId);
  const snapshots = org?.snapshots ?? [];

  return (
    <div className="max-w-5xl mx-auto px-6 pb-16 space-y-8">
      {/* Org header */}
      <div className="pt-8">
        {orgLoading ? (
          <Skeleton className="h-8 w-48" />
        ) : (
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{org?.label ?? `Org ${orgId}`}</h1>
            <Badge variant="outline" className="text-xs">Imported</Badge>
          </div>
        )}
      </div>

      {/* Snapshot selector */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Snapshot History</CardTitle></CardHeader>
          <CardContent>
            <SnapshotHistory
              orgId={orgId}
              orgLabel={org?.label ?? `Org ${orgId}`}
              snapshots={snapshots}
              activeSnapshotId={snapshotId}
              onSelectSnapshot={setSelectedSnapshotId}
            />
          </CardContent>
        </Card>
      )}

      {!orgLoading && snapshots.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No snapshots for this org.{' '}
          <a href="#/import" className="text-primary hover:underline">Import a bundle</a> to get started.
        </p>
      )}

      {/* Loading state */}
      {dataFetching && !bundle && (
        <div className="space-y-4">
          <Skeleton className="h-[350px] w-full" />
          <Skeleton className="h-[350px] w-full" />
        </div>
      )}

      {/* Executive summary stats */}
      {bundle?.executiveSummary && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCalloutBox label="Total Commits" value={String(bundle.executiveSummary.totalCommits ?? 0)} />
            <StatCalloutBox label="Active Contributors" value={String(bundle.executiveSummary.activeContributors ?? 0)} />
            {bundle.executiveSummary.rampUpTrend && (
              <StatCalloutBox label="Ramp-Up Trend" value={bundle.executiveSummary.rampUpTrend} />
            )}
            {bundle.executiveSummary.aiAdoptionDelta && (
              <StatCalloutBox label="AI Adoption Delta" value={bundle.executiveSummary.aiAdoptionDelta} />
            )}
          </div>
        </section>
      )}

      {/* Cohort commits chart */}
      {bundle?.cohortCommits && bundle.cohortCommits.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Cohort Commits</CardTitle>
              <select
                value={commitMetric}
                onChange={e => setCommitMetric(e.target.value as CommitMetric)}
                className="text-xs border border-input rounded-md px-2 py-1 bg-transparent"
              >
                <option value="avgLinesAdded">Avg Lines Added</option>
                <option value="avgLinesDeleted">Avg Lines Deleted</option>
                <option value="avgFilesChanged">Avg Files Changed</option>
                <option value="totalCount">Total Count</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            <InlineCohortChart data={bundle.cohortCommits} metric={commitMetric} aiMarkerDate={bundle.metadata?.aiMarkerDate ?? null} />
          </CardContent>
        </Card>
      )}

      {/* Cohort PRs chart */}
      {bundle?.cohortPrs && bundle.cohortPrs.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Cohort Pull Requests</CardTitle></CardHeader>
          <CardContent>
            <InlineCohortChart data={bundle.cohortPrs} metric="totalCount" aiMarkerDate={bundle.metadata?.aiMarkerDate ?? null} />
          </CardContent>
        </Card>
      )}

      {/* Ramp-up chart */}
      {bundle?.rampUp && bundle.rampUp.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Ramp-Up Speed</CardTitle></CardHeader>
          <CardContent>
            <InlineRampUpChart data={bundle.rampUp} />
          </CardContent>
        </Card>
      )}

      {/* PR Turnaround */}
      {bundle?.prTurnaround && bundle.prTurnaround.length > 0 && (
        <Card>
          <CardHeader><CardTitle>PR Turnaround</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {bundle.prTurnaround.slice(-3).map(row => (
                <StatCalloutBox
                  key={row.periodMonth}
                  label={row.periodMonth}
                  value={`${Math.round(row.avgHoursToMerge)}h avg`}
                  delta={`${row.prCount} PRs`}
                  deltaDir="neutral"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bot ratio */}
      {bundle?.botRatio && bundle.botRatio.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Bot vs Human Commits</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {bundle.botRatio.slice(-3).map(row => (
                <StatCalloutBox
                  key={row.periodMonth}
                  label={row.periodMonth}
                  value={`${row.botPercentage.toFixed(1)}% bot`}
                  delta={`${row.totalCommits} commits`}
                  deltaDir="neutral"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
