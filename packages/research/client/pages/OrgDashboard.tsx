import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, TableProperties } from 'lucide-react';
import { Badge } from '@shared/components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs.js';
import { StatCalloutBox } from '@shared/components/charts/StatCalloutBox.js';
import { StatCalloutRow } from '@shared/components/charts/StatCalloutRow.js';
import NarrativeCard from '@shared/components/charts/NarrativeCard.js';
import CohortAreaChart from '@shared/components/charts/CohortAreaChart.js';
import { CohortDataTable } from '@shared/components/charts/CohortDataTable.js';
import RampUpLineChart from '@shared/components/charts/RampUpLineChart.js';
import { RampUpDataTable } from '@shared/components/charts/RampUpDataTable.js';
import { HelpPanel } from '@shared/components/HelpPanel.js';
import { TeamDistributionChart } from '@shared/components/charts/TeamDistributionChart.js';
import { TeamDistributionTable } from '@shared/components/charts/TeamDistributionTable.js';
import { BeforeAfterComparison } from '@shared/components/charts/BeforeAfterComparison.js';
import { computeCohortInsights, computeRampUpInsights } from '@shared/lib/insights.js';
import { cohortTrendNarrative, METRIC_NARRATIVE_LABELS, METRIC_OPTIONS, CONCENTRATION_BASIS_OPTIONS } from '@shared/lib/narratives.js';
import type { MetricOption } from '@shared/lib/narratives.js';
import type { ConcentrationBasis, ConcentrationMonthlyRow, PeriodMetric } from '@shared/types.js';
import SnapshotHistory from '../components/SnapshotHistory.js';
import { useOrg } from '../hooks/useOrgs.js';
import OrgMetadataForm from '../components/OrgMetadataForm.js';
import { useSnapshotData } from '../hooks/useSnapshotData.js';

interface OrgDashboardProps {
  orgId: number;
}

export default function OrgDashboard({ orgId }: OrgDashboardProps) {
  const { data: org, isLoading: orgLoading } = useOrg(orgId);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [commitMetric, setCommitMetric] = useState<MetricOption>('totalCount');
  const [prMetric, setPrMetric] = useState<MetricOption>('totalCount');
  const [cohortPrView, setCohortPrView] = useState<'chart' | 'table'>('chart');
  const [cohortCommitView, setCohortCommitView] = useState<'chart' | 'table'>('chart');
  const [rampUpView, setRampUpView] = useState<'chart' | 'table'>('chart');
  const [concentrationBasis, setConcentrationBasis] = useState<ConcentrationBasis>('prs');
  const [concentrationView, setConcentrationView] = useState<'chart' | 'table'>('chart');

  const snapshotId = selectedSnapshotId ?? (org?.snapshots?.[0]?.id ?? null);
  const { data: bundle, isFetching: dataFetching } = useSnapshotData(orgId, snapshotId);

  // Concentration, headcount, and period-metrics from research API (Phase 9.4)
  const { data: concentrationData, isLoading: concentrationLoading } = useQuery<ConcentrationMonthlyRow[]>({
    queryKey: ['research', 'concentration', orgId],
    queryFn: () => fetch(`/api/orgs/${orgId}/concentration`).then(r => r.json()),
    enabled: orgId != null,
  });
  const { data: periodMetricsData, isLoading: periodMetricsLoading } = useQuery<PeriodMetric[] | null>({
    queryKey: ['research', 'period-metrics', orgId],
    queryFn: () => fetch(`/api/orgs/${orgId}/period-metrics`).then(r => r.json()),
    enabled: orgId != null,
  });
  const snapshots = org?.snapshots ?? [];

  // Dynamic chart config from bundle metadata
  const dynamicChartConfig = bundle?.metadata?.cohortConfig
    ? Object.fromEntries(
        bundle.metadata.cohortConfig.thresholds.map(t => [t.key, { label: t.label, color: t.color }])
      )
    : undefined;

  // AI marker date from bundle (per D-11)
  const aiMarkerDate = bundle?.metadata?.aiMarkerDate ?? null;

  // Compute insights (per D-08)
  const prInsights = computeCohortInsights(bundle?.cohortPrs ?? [], prMetric, 'pr');
  const commitInsights = computeCohortInsights(bundle?.cohortCommits ?? [], commitMetric, 'commit');
  const rampUpInsights = computeRampUpInsights(bundle?.rampUp ?? [], !!aiMarkerDate);

  return (
    <div className="max-w-5xl mx-auto px-6 pb-16 space-y-8">
      {/* Org header */}
      <div className="pt-8">
        {orgLoading ? (
          <Skeleton className="h-8 w-48" />
        ) : (
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{org?.label ?? `Org ${orgId}`}</h1>
            <Badge variant="outline" className="text-xs">Imported</Badge>
          </div>
        )}
      </div>

      {!orgLoading && org && <OrgMetadataForm org={org} />}

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

      {/* Team Distribution (Phase 9.4) */}
      <section>
        <div className="mt-4 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">Team Distribution</h3>
              <div className="flex items-center gap-2">
                <Tabs value={concentrationBasis} onValueChange={(v) => setConcentrationBasis(v as ConcentrationBasis)}>
                  <TabsList className="h-8 gap-1">
                    {CONCENTRATION_BASIS_OPTIONS.map(({ label, value }) => (
                      <TabsTrigger key={value} value={value} className="text-xs px-3 py-1 data-active:bg-primary data-active:text-primary-foreground">
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                <Tabs value={concentrationView} onValueChange={(v) => setConcentrationView(v as 'chart' | 'table')}>
                  <TabsList className="h-7 gap-0 bg-transparent border border-border rounded-md p-0">
                    <TabsTrigger value="chart" className="h-full px-2 py-1 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view">
                      <BarChart3 className="h-3.5 w-3.5" />
                    </TabsTrigger>
                    <TabsTrigger value="table" className="h-full px-2 py-1 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view">
                      <TableProperties className="h-3.5 w-3.5" />
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>
            <div className="mt-4">
              {concentrationView === 'chart' ? (
                <TeamDistributionChart
                  data={(concentrationData ?? []).filter(r => r.basis === concentrationBasis)}
                  aiMarkerDate={aiMarkerDate}
                  isLoading={concentrationLoading}
                />
              ) : (
                <TeamDistributionTable
                  data={(concentrationData ?? []).filter(r => r.basis === concentrationBasis)}
                />
              )}
            </div>
            <HelpPanel>
              <p>
                Team Distribution shows how code contributions are spread across your team over time.
                The concentration chart tracks what percentage of monthly output comes from your most
                active contributors. High concentration (one person doing 40-50%+ of PRs) signals bus
                factor risk -- if that person leaves, the team may struggle to absorb the gap.
              </p>
              <p className="mt-2">
                The HHI (Herfindahl-Hirschman Index) overlay line measures overall concentration on a
                0-1 scale. Values above 0.25 indicate significant concentration. The table view also
                includes the Gini coefficient, which captures the full inequality spread across all
                contributors.
              </p>
              <p className="mt-2">
                Bus Factor shows the minimum number of developers whose combined contributions reach
                50% of monthly output. A bus factor of 1 means a single person accounts for half the
                work -- a clear resilience risk.
              </p>
              <p className="mt-2">
                The PRs/Commits/Lines tabs show concentration computed over different contribution
                measures. PRs reflect review-based workflows. Commits reflect direct code changes.
                Lines of code should be interpreted with caution: large refactors, generated code,
                vendored dependencies, and auto-formatting can dominate the lines signal without
                reflecting meaningful development effort. Lines are useful for spotting refactor waves
                but misleading as a measure of who did more work.
              </p>
            </HelpPanel>
          </div>
        </div>
      </section>

      {/* Cohort Commit Size Trends */}
      {bundle?.cohortCommits && (
        <section>
          <div className="mt-4 space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold">Commit Size Trends</h3>
                <div className="flex items-center gap-2">
                  <Tabs value={commitMetric} onValueChange={(v) => setCommitMetric(v as MetricOption)}>
                    <TabsList className="h-8 gap-1">
                      {METRIC_OPTIONS.map(({ label, value }) => (
                        <TabsTrigger key={value} value={value} className="text-xs px-3 py-1 data-active:bg-primary data-active:text-primary-foreground">
                          {label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  <Tabs value={cohortCommitView} onValueChange={(v) => setCohortCommitView(v as 'chart' | 'table')}>
                    <TabsList className="h-7 gap-0 bg-transparent border border-border rounded-md p-0">
                      <TabsTrigger value="chart" className="h-full px-2 py-1 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view">
                        <BarChart3 className="h-3.5 w-3.5" />
                      </TabsTrigger>
                      <TabsTrigger value="table" className="h-full px-2 py-1 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view">
                        <TableProperties className="h-3.5 w-3.5" />
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </div>
              <StatCalloutRow>
                {commitInsights.map((insight) => (
                  <StatCalloutBox
                    key={insight.label}
                    label={insight.label}
                    value={insight.value}
                    delta={insight.delta}
                    deltaDir={insight.deltaDir}
                    isLoading={dataFetching && !bundle?.cohortCommits}
                  />
                ))}
              </StatCalloutRow>
              <div className="mt-4">
                {cohortCommitView === 'chart' ? (
                  <>
                    <NarrativeCard
                      text={cohortTrendNarrative(bundle.cohortCommits, commitMetric, METRIC_NARRATIVE_LABELS[commitMetric].commit)}
                      isFetching={dataFetching && !bundle?.cohortCommits}
                    />
                    <CohortAreaChart
                      data={bundle.cohortCommits}
                      metric={commitMetric}
                      title="Commit Count by Cohort"
                      aiMarkerDate={aiMarkerDate}
                      isFetching={dataFetching && !bundle?.cohortCommits}
                      chartConfig={dynamicChartConfig}
                    />
                  </>
                ) : (
                  <CohortDataTable
                    data={bundle.cohortCommits}
                    metric={commitMetric}
                    isFetching={dataFetching && !bundle?.cohortCommits}
                    chartConfig={dynamicChartConfig}
                  />
                )}
              </div>
              <HelpPanel>
                <p>
                  This section shows how the average size of individual commits has changed over
                  time, broken down by contributor tenure cohort. The y-axis reflects the
                  selected metric: commit count, average lines added, lines deleted, or files
                  changed per commit.
                </p>
                <p className="mt-2">
                  Commit size is a different signal from PR size: smaller commits often reflect
                  more iterative development practices, while larger commits may indicate batch
                  work or infrequent saves. AI coding assistants tend to produce larger
                  individual changes, so an increase in average lines per commit after your
                  AI adoption date, especially in the new-dev cohort, can be an early
                  adoption signal.
                </p>
                <p className="mt-2">
                  If the new-dev cohort line rises faster than senior contributors after your
                  AI date, newer team members may be generating more code per commit, which
                  is worth pairing with the Ramp-Up chart to confirm whether this reflects
                  productivity or noise. Use the metric toggle above to explore
                  which signals are most visible in your data.
                </p>
                <p className="mt-2">
                  Cohort boundaries are determined by the import snapshot — they reflect
                  configuration at the time of export.
                </p>
              </HelpPanel>
            </div>
          </div>
        </section>
      )}

      {/* Cohort PR Size Trends */}
      {bundle?.cohortPrs && (
        <section>
          <div className="mt-4 space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold">PR Size Trends</h3>
                <div className="flex items-center gap-2">
                  <Tabs value={prMetric} onValueChange={(v) => setPrMetric(v as MetricOption)}>
                    <TabsList className="h-8 gap-1">
                      {METRIC_OPTIONS.map(({ label, value }) => (
                        <TabsTrigger key={value} value={value} className="text-xs px-3 py-1 data-active:bg-primary data-active:text-primary-foreground">
                          {label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  <Tabs value={cohortPrView} onValueChange={(v) => setCohortPrView(v as 'chart' | 'table')}>
                    <TabsList className="h-7 gap-0 bg-transparent border border-border rounded-md p-0">
                      <TabsTrigger value="chart" className="h-full px-2 py-1 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view">
                        <BarChart3 className="h-3.5 w-3.5" />
                      </TabsTrigger>
                      <TabsTrigger value="table" className="h-full px-2 py-1 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view">
                        <TableProperties className="h-3.5 w-3.5" />
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </div>
              <StatCalloutRow>
                {prInsights.map((insight) => (
                  <StatCalloutBox
                    key={insight.label}
                    label={insight.label}
                    value={insight.value}
                    delta={insight.delta}
                    deltaDir={insight.deltaDir}
                    isLoading={dataFetching && !bundle?.cohortPrs}
                  />
                ))}
              </StatCalloutRow>
              <div className="mt-4">
                {cohortPrView === 'chart' ? (
                  <>
                    <NarrativeCard
                      text={cohortTrendNarrative(bundle.cohortPrs, prMetric, METRIC_NARRATIVE_LABELS[prMetric].pr)}
                      isFetching={dataFetching && !bundle?.cohortPrs}
                    />
                    <CohortAreaChart
                      data={bundle.cohortPrs}
                      metric={prMetric}
                      title="PR Count by Cohort"
                      aiMarkerDate={aiMarkerDate}
                      isFetching={dataFetching && !bundle?.cohortPrs}
                      chartConfig={dynamicChartConfig}
                    />
                  </>
                ) : (
                  <CohortDataTable
                    data={bundle.cohortPrs}
                    metric={prMetric}
                    isFetching={dataFetching && !bundle?.cohortPrs}
                    chartConfig={dynamicChartConfig}
                  />
                )}
              </div>
              <HelpPanel>
                <p>
                  This section shows how the average size of pull requests has changed over time,
                  grouped by how long contributors had been active when they opened each PR.
                  The x-axis is time (by month), and the y-axis shows the selected metric:
                  PR count, average lines added, lines deleted, or files changed.
                </p>
                <p className="mt-2">
                  Each cohort line (new devs, mid-tenure, senior) tells a different story.
                  If you see the new-dev line rising steeply after your AI adoption date, that
                  suggests newer contributors are taking on larger or more frequent PRs, a
                  common signal of AI-assisted productivity. If all cohort lines move together,
                  the trend is likely org-wide rather than experience-dependent.
                </p>
                <p className="mt-2">
                  Look for divergence between cohorts after your AI marker: if new devs close
                  the gap with senior contributors, consider investigating whether your AI
                  tooling is accelerating onboarding. If senior PR sizes are shrinking, they
                  may be decomposing work into smaller, more reviewable units.
                </p>
                <p className="mt-2">
                  You can switch the metric with the tabs above. Cohort boundaries are set by
                  the data source — the exported snapshot determines how contributors are grouped.
                </p>
              </HelpPanel>
            </div>
          </div>
        </section>
      )}

      {/* New Developer Ramp-Up */}
      {bundle?.rampUp && (
        <section>
          <div className="mt-4 space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold">New Developer Ramp-Up</h3>
                <div className="flex items-center gap-2">
                  <Tabs value={rampUpView} onValueChange={(v) => setRampUpView(v as 'chart' | 'table')}>
                    <TabsList className="h-7 gap-0 bg-transparent border border-border rounded-md p-0">
                      <TabsTrigger value="chart" className="h-full px-2 py-1 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view">
                        <BarChart3 className="h-3.5 w-3.5" />
                      </TabsTrigger>
                      <TabsTrigger value="table" className="h-full px-2 py-1 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view">
                        <TableProperties className="h-3.5 w-3.5" />
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </div>
              <StatCalloutRow>
                {rampUpInsights.map((insight) => (
                  <StatCalloutBox
                    key={insight.label}
                    label={insight.label}
                    value={insight.value}
                    delta={insight.delta}
                    deltaDir={insight.deltaDir}
                    isLoading={dataFetching && !bundle?.rampUp}
                  />
                ))}
              </StatCalloutRow>
              <div className="mt-4">
                {rampUpView === 'chart' ? (
                  <RampUpLineChart data={bundle.rampUp} isFetching={dataFetching && !bundle?.rampUp} />
                ) : (
                  <RampUpDataTable data={bundle.rampUp ?? []} isFetching={dataFetching && !bundle?.rampUp} />
                )}
              </div>
              <HelpPanel>
                <p>
                  This section shows how quickly new contributors reached meaningful contribution
                  sizes after joining, grouped by the quarter they made their first commit.
                </p>
                <p className="mt-2">
                  Each line represents a cohort of developers who joined in a specific quarter.
                  The x-axis shows weeks since first commit; the y-axis shows average PR or
                  commit size. A steeper, earlier rise means contributors in that cohort ramped
                  up faster.
                </p>
                <p className="mt-2">
                  Compare cohorts that joined before versus after your AI adoption date. If
                  post-AI cohorts reach the same contribution size in fewer weeks, that is a
                  concrete signal that AI tooling is accelerating onboarding. A flat or slow
                  ramp-up for recent cohorts may indicate a different bottleneck worth
                  investigating.
                </p>
              </HelpPanel>
            </div>
          </div>
        </section>
      )}

      {/* Before/After AI Adoption (rewired to periodMetrics per Phase 9.4 D-13) */}
      <BeforeAfterComparison
        periodMetrics={periodMetricsData ?? null}
        isLoading={periodMetricsLoading}
      />

      {/* PR Turnaround */}
      {bundle?.prTurnaround && bundle.prTurnaround.length > 0 && (
        <Card>
          <CardHeader><CardTitle>PR Turnaround Time</CardTitle></CardHeader>
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
          <CardContent className="pt-0">
            <HelpPanel>
              <p>
                This section shows how long pull requests take from opening to merge. Faster
                turnaround often reflects smaller PR sizes, more focused changes, or stronger
                review culture — all common effects of AI-assisted development.
              </p>
              <p className="mt-2">
                An improvement in PR turnaround after your AI adoption date is a positive
                signal, especially if combined with increased PR volume from newer contributors.
              </p>
            </HelpPanel>
          </CardContent>
        </Card>
      )}

      {/* Bot Ratio */}
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
          <CardContent className="pt-0">
            <HelpPanel>
              <p>
                This section shows the proportion of commits attributed to automated tools
                (Dependabot, Renovate, GitHub Actions bots) versus human contributors.
              </p>
              <p className="mt-2">
                A rising bot ratio is normal as projects adopt more automation. However, a
                sudden spike may indicate a tooling change rather than a human-contribution
                trend. Use this as a sanity check when interpreting the cohort charts.
              </p>
            </HelpPanel>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
