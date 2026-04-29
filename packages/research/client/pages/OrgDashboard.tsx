import { useState } from 'react';
import { BarChart3, TableProperties } from 'lucide-react';
import { Badge } from '@shared/components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select.js';
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
import {
  DeveloperTrajectoryGrid,
  chooseDevLayout,
  type DeveloperWithRows,
} from '@shared/components/charts/DeveloperTrajectoryGrid.js';
import { DeveloperTrajectoryList } from '@shared/components/charts/DeveloperTrajectoryList.js';
import { DeveloperZoomModal } from '@shared/components/charts/DeveloperZoomModal.js';
import { computeCohortInsights, computeRampUpInsights } from '@shared/lib/insights.js';
import { cohortTrendNarrative, METRIC_NARRATIVE_LABELS, METRIC_OPTIONS, CONCENTRATION_BASIS_OPTIONS, DEVELOPER_METRIC_OPTIONS } from '@shared/lib/narratives.js';
import type { MetricOption, DeveloperMetricOption } from '@shared/lib/narratives.js';
import type { ConcentrationBasis } from '@shared/types.js';
import type { DeveloperMonthlyRow } from '@shared/export-types.js';
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

  // Phase 9.5 (D-12, D-13, D-14, D-15): Contribution Patterns section state
  const [contribMetric, setContribMetric] = useState<DeveloperMetricOption>('prCount');
  const [zoomedDev, setZoomedDev] = useState<string | null>(null);
  const [cohortFilter, setCohortFilter] = useState<'senior' | 'mid' | 'new' | 'all'>('all');
  const [minActiveMonths, setMinActiveMonths] = useState<number>(1);

  const snapshotId = selectedSnapshotId ?? (org?.snapshots?.[0]?.id ?? null);
  const { data: bundle, isFetching: dataFetching } = useSnapshotData(orgId, snapshotId);

  // Concentration and period-metrics are read from the reconstructed snapshot
  // bundle (the H2 fix endpoint), NOT from separate org-level queries. Using
  // bundle.* here ensures the Team Distribution section reacts to snapshot
  // selection — the org-level endpoints would pin to the latest snapshot.
  //
  // The sibling `/api/orgs/:orgId/headcount` route also exists (see
  // packages/research/server/routes/orgs.ts) but is intentionally NOT consumed
  // here: D-15 holds the research-tool Team Distribution section to a minimal
  // spec (no ScaryRealPanel, no StatCalloutRow), so there is no current UI
  // surface that would render headcount. The route is available for Phase 9.7
  // cross-org aggregation.
  const concentrationData = bundle?.concentrationMonthly ?? [];
  const periodMetricsData = bundle?.periodMetrics ?? null;
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

  // Phase 9.5 (D-12, D-14, D-15): Build per-developer rows + apply Cohort + Min Activity filters
  const developerRows: DeveloperMonthlyRow[] = bundle?.developerMonthly ?? [];

  // Group rows by author + look up cohort/tenure from bundle.contributors
  const distinctAuthorsAll = Array.from(new Set(developerRows.map(r => r.authorLogin)));
  const allDevelopersWithRows: DeveloperWithRows[] = distinctAuthorsAll.map(login => {
    const rows = developerRows.filter(r => r.authorLogin === login);
    const contrib = (bundle?.contributors ?? []).find((c: { authorLogin: string }) => c.authorLogin === login);
    const tenureJoinedAt = (contrib as { firstCommitAt?: string | null } | undefined)?.firstCommitAt ?? null;
    const cohortKey = (contrib as { cohort?: string } | undefined)?.cohort ?? 'mid';
    return { authorLogin: login, tenureJoinedAt, cohortKey, rows };
  });

  // Apply Cohort filter (D-15)
  const cohortFiltered = cohortFilter === 'all'
    ? allDevelopersWithRows
    : allDevelopersWithRows.filter(d => d.cohortKey === cohortFilter);

  // Apply Min Activity filter (D-15) — count distinct months with any activity
  const filteredDevs = cohortFiltered.filter(d => {
    const activeMonths = d.rows.filter(r => r.prCount > 0 || r.commitCount > 0).length;
    return activeMonths >= minActiveMonths;
  });

  // Sort by tenure descending (D-06 — longest-tenured first)
  filteredDevs.sort((a, b) =>
    (a.tenureJoinedAt ?? '9999').localeCompare(b.tenureJoinedAt ?? '9999')
  );

  // D-14: layout switch based on filtered active dev count (threshold 8 — chooseDevLayout)
  const activeDevsCount = filteredDevs.length;
  const contribLayoutMode = chooseDevLayout(activeDevsCount);

  // Cohort means (cohort-relative overlay) and cohort band (modal only)
  const contribCohortMeans = computeCohortMeans(filteredDevs, contribMetric);
  const zoomedDevObj = zoomedDev ? filteredDevs.find(d => d.authorLogin === zoomedDev) : null;
  const contribCohortBand = zoomedDevObj
    ? computeCohortBand(filteredDevs, zoomedDevObj.cohortKey, contribMetric)
    : new Map<string, { p25: number | null; p75: number | null }>();
  const contribCohortMeanForZoom = zoomedDevObj
    ? (contribCohortMeans.get(zoomedDevObj.cohortKey) ?? new Map<string, number | null>())
    : new Map<string, number | null>();

  const contribAiMarkerMonth = aiMarkerDate ? aiMarkerDate.slice(0, 7) : null;

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
              <h2 className="text-base font-semibold">Team Distribution</h2>
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
                  isLoading={dataFetching && !bundle?.concentrationMonthly}
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

      {/* Phase 9.5: Contribution Patterns section (D-12, D-13, D-14, D-15) */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold tracking-tight">Contribution Patterns</h2>
        </div>
        <div className="space-y-4">
          {/* HelpPanel — D-13 SHORTER copy verbatim. Always default-open since D-13 has no opt-in collapse. */}
          <HelpPanel defaultOpen={true}>
            <p>
              Per-developer monthly trajectories for this snapshot. Pseudonyms are applied at export time (animal names). Patterns at the cohort level reveal team dynamics; individual variation mostly reflects role/project type, not effort or skill. Use the metric tabs to switch between PRs, commits, lines per commit, and files per commit. Click any chart for a larger view with cohort-band context.
            </p>
          </HelpPanel>

          {/* Filters: Cohort dropdown + Min Activity slider (D-15) + metric Tabs (D-03) */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Cohort filter — D-15 verbatim options */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Cohort:</span>
              <Select value={cohortFilter} onValueChange={(v) => setCohortFilter(v as 'senior' | 'mid' | 'new' | 'all')}>
                <SelectTrigger className="h-7 text-xs w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="senior">Senior</SelectItem>
                  <SelectItem value="mid">Mid</SelectItem>
                  <SelectItem value="new">Junior</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Min Activity slider — D-15. Plain HTML <input type="range"> (no shadcn Slider primitive exists). */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor="min-activity-slider">
                Min activity: {minActiveMonths} active month{minActiveMonths === 1 ? '' : 's'}
              </label>
              <input
                id="min-activity-slider"
                type="range"
                min={1}
                max={12}
                value={minActiveMonths}
                onChange={(e) => setMinActiveMonths(Number(e.target.value))}
                className="w-32"
              />
            </div>

            {/* Metric Tabs — D-03 verbatim labels */}
            <div className="ml-auto">
              <Tabs value={contribMetric} onValueChange={(v) => setContribMetric(v as DeveloperMetricOption)}>
                <TabsList className="h-8 gap-1">
                  {DEVELOPER_METRIC_OPTIONS.map(opt => (
                    <TabsTrigger
                      key={opt.value}
                      value={opt.value}
                      className="text-xs px-3 py-1 data-active:bg-primary data-active:text-primary-foreground"
                    >
                      {opt.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>

          {filteredDevs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active contributors in the selected date range.</p>
          ) : (
            contribLayoutMode === 'grid' ? (
              <DeveloperTrajectoryGrid
                developers={filteredDevs}
                metric={contribMetric}
                aiMarkerMonth={contribAiMarkerMonth}
                cohortMeanByMonthAndCohort={contribCohortMeans}
                onChartClick={setZoomedDev}
                isLoading={dataFetching && !bundle?.developerMonthly}
              />
            ) : (
              <DeveloperTrajectoryList
                developers={filteredDevs}
                metric={contribMetric}
                aiMarkerMonth={contribAiMarkerMonth}
                cohortMeanByMonthAndCohort={contribCohortMeans}
                onChartClick={setZoomedDev}
                isLoading={dataFetching && !bundle?.developerMonthly}
              />
            )
          )}

          {/* Click-to-zoom modal (D-05) — same component as main app, populated with research-tool data */}
          {zoomedDevObj && (
            <DeveloperZoomModal
              open={zoomedDev !== null}
              onOpenChange={(open) => { if (!open) setZoomedDev(null); }}
              authorLogin={zoomedDevObj.authorLogin}
              rows={zoomedDevObj.rows}
              cohortMeanByMonth={contribCohortMeanForZoom}
              cohortBandByMonth={contribCohortBand}
              aiMarkerMonth={contribAiMarkerMonth}
              initialMetric={contribMetric}
            />
          )}
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
        isLoading={dataFetching && bundle?.periodMetrics === undefined}
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

// Phase 9.5 helpers — copied from Plan 07 (DashboardPage). If both files diverge,
// promote to a shared lib at packages/shared/lib/developer-monthly-helpers.ts.

function metricValue(row: DeveloperMonthlyRow, metric: DeveloperMetricOption): number | null {
  switch (metric) {
    case 'prCount': return row.prCount;
    case 'commitCount': return row.commitCount;
    case 'linesPerCommit': return row.meanLinesPerCommit;
    case 'filesPerCommit': return row.meanFilesPerCommit;
  }
}

function computeCohortMeans(
  devs: DeveloperWithRows[],
  metric: DeveloperMetricOption,
): Map<string, Map<string, number | null>> {
  const out = new Map<string, Map<string, number | null>>();
  const buckets = new Map<string, Map<string, number[]>>();
  for (const dev of devs) {
    if (!buckets.has(dev.cohortKey)) buckets.set(dev.cohortKey, new Map());
    for (const r of dev.rows) {
      const v = metricValue(r, metric);
      if (v === null) continue;
      if (!buckets.get(dev.cohortKey)!.has(r.month)) buckets.get(dev.cohortKey)!.set(r.month, []);
      buckets.get(dev.cohortKey)!.get(r.month)!.push(v);
    }
  }
  for (const [cohortKey, monthMap] of buckets) {
    const result = new Map<string, number | null>();
    for (const [month, values] of monthMap) {
      result.set(month, values.length > 0 ? values.reduce((s, x) => s + x, 0) / values.length : null);
    }
    out.set(cohortKey, result);
  }
  return out;
}

function computeCohortBand(
  devs: DeveloperWithRows[],
  cohortKey: string,
  metric: DeveloperMetricOption,
): Map<string, { p25: number | null; p75: number | null }> {
  const monthMap = new Map<string, number[]>();
  for (const dev of devs) {
    if (dev.cohortKey !== cohortKey) continue;
    for (const r of dev.rows) {
      const v = metricValue(r, metric);
      if (v === null) continue;
      if (!monthMap.has(r.month)) monthMap.set(r.month, []);
      monthMap.get(r.month)!.push(v);
    }
  }
  const out = new Map<string, { p25: number | null; p75: number | null }>();
  for (const [month, values] of monthMap) {
    if (values.length < 2) {
      out.set(month, { p25: null, p75: null });
      continue;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const p25Idx = Math.floor(sorted.length * 0.25);
    const p75Idx = Math.floor(sorted.length * 0.75);
    out.set(month, { p25: sorted[p25Idx], p75: sorted[p75Idx] });
  }
  return out;
}
