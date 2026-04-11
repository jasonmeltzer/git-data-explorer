import { useState } from 'react';
import { Badge } from '@shared/components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
import { StatCalloutBox } from '@shared/components/charts/StatCalloutBox.js';
import CohortAreaChart from '@shared/components/charts/CohortAreaChart.js';
import RampUpLineChart from '@shared/components/charts/RampUpLineChart.js';
import RollingCards from '@shared/components/charts/RollingCards.js';
import OrgSidebar from '../components/OrgSidebar.js';
import OrgMetadataForm from '../components/OrgMetadataForm.js';
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
  const [rollingGranularity, setRollingGranularity] = useState<'month' | 'quarter'>('month');
  const [commitMetric, setCommitMetric] = useState<CommitMetric>('avgLinesAdded');

  // Use first snapshot if none selected
  const snapshotId =
    selectedSnapshotId ?? (org?.snapshots?.[0]?.id ?? null);

  const { data: bundle, isFetching: dataFetching } = useSnapshotData(orgId, snapshotId);

  const snapshots = org?.snapshots ?? [];

  return (
    <div className="flex min-h-screen">
      <OrgSidebar activeOrgId={orgId} />
      <div className="flex-1 min-w-0 px-6 py-8 space-y-8">
        {/* Org header */}
        {orgLoading ? (
          <Skeleton className="h-8 w-48" />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold">{org?.label ?? `Org ${orgId}`}</h1>
              <Badge variant="outline" className="text-xs">Imported</Badge>
            </div>
            {org && <OrgMetadataForm org={org} />}
          </div>
        )}

        {/* Snapshot selector */}
        {snapshots.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Snapshot History</CardTitle>
            </CardHeader>
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

        {/* No snapshots */}
        {!orgLoading && snapshots.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No snapshots for this org.{' '}
            <a href="#/import" className="text-primary hover:underline">Import a bundle</a> to get started.
          </p>
        )}

        {/* Executive summary stats */}
        {bundle?.executiveSummary && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Summary</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCalloutBox
                label="Total Commits"
                value={String(bundle.executiveSummary.totalCommits ?? 0)}
              />
              <StatCalloutBox
                label="Active Contributors"
                value={String(bundle.executiveSummary.activeContributors ?? 0)}
              />
              {bundle.executiveSummary.rampUpTrend && (
                <StatCalloutBox
                  label="Ramp-Up Trend"
                  value={bundle.executiveSummary.rampUpTrend}
                />
              )}
              {bundle.executiveSummary.aiAdoptionDelta && (
                <StatCalloutBox
                  label="AI Adoption Delta"
                  value={bundle.executiveSummary.aiAdoptionDelta}
                />
              )}
            </div>
          </section>
        )}

        {/* Cohort commits chart */}
        {(bundle?.cohortCommits || dataFetching) && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Cohort Commits</CardTitle>
                <select
                  value={commitMetric}
                  onChange={e => setCommitMetric(e.target.value as CommitMetric)}
                  className="text-xs border border-input rounded-md px-2 py-1 bg-transparent"
                  aria-label="Select commit metric"
                >
                  <option value="avgLinesAdded">Avg Lines Added</option>
                  <option value="avgLinesDeleted">Avg Lines Deleted</option>
                  <option value="avgFilesChanged">Avg Files Changed</option>
                  <option value="totalCount">Total Count</option>
                </select>
              </div>
            </CardHeader>
            <CardContent>
              <CohortAreaChart
                data={bundle?.cohortCommits ?? []}
                metric={commitMetric}
                title="Cohort Commits"
                aiMarkerDate={bundle?.metadata?.aiMarkerDate ?? null}
                isFetching={dataFetching && !bundle}
              />
            </CardContent>
          </Card>
        )}

        {/* Cohort PRs chart */}
        {(bundle?.cohortPrs || dataFetching) && (
          <Card>
            <CardHeader>
              <CardTitle>Cohort Pull Requests</CardTitle>
            </CardHeader>
            <CardContent>
              <CohortAreaChart
                data={bundle?.cohortPrs ?? []}
                metric="totalCount"
                title="Cohort Pull Requests"
                aiMarkerDate={bundle?.metadata?.aiMarkerDate ?? null}
                isFetching={dataFetching && !bundle}
              />
            </CardContent>
          </Card>
        )}

        {/* Ramp-up chart */}
        {(bundle?.rampUp || dataFetching) && (
          <Card>
            <CardHeader>
              <CardTitle>Ramp-Up Speed</CardTitle>
            </CardHeader>
            <CardContent>
              <RampUpLineChart
                data={bundle?.rampUp ?? []}
                isFetching={dataFetching && !bundle}
              />
            </CardContent>
          </Card>
        )}

        {/* Rolling comparison */}
        {bundle?.rolling && (
          <Card>
            <CardHeader>
              <CardTitle>Rolling Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <RollingCards
                data={bundle.rolling}
                isFetching={dataFetching}
                granularity={rollingGranularity}
                onGranularityChange={setRollingGranularity}
              />
            </CardContent>
          </Card>
        )}

        {/* PR Turnaround */}
        {bundle?.prTurnaround && bundle.prTurnaround.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>PR Turnaround</CardTitle>
            </CardHeader>
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
            <CardHeader>
              <CardTitle>Bot vs Human Commits</CardTitle>
            </CardHeader>
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
    </div>
  );
}
