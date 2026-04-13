import { useState } from 'react';
import { Badge } from '@shared/components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
import { StatCalloutBox } from '@shared/components/charts/StatCalloutBox.js';
import { InlineCohortChart, InlineRampUpChart } from '../components/InlineCharts.js';
import SnapshotHistory from '../components/SnapshotHistory.js';
import { useOrg } from '../hooks/useOrgs.js';
import { useSnapshotData } from '../hooks/useSnapshotData.js';

interface OrgDashboardProps {
  orgId: number;
}

type CommitMetric = 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged' | 'totalCount';

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
