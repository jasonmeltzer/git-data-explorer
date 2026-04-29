import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, TableProperties, ChevronDown, ChevronRight } from 'lucide-react';
import { useDashboardFilters } from '../hooks/useDashboardFilters.js';
import { useAiMarker } from '../hooks/useAiMarker.js';
import { useCohortConfig } from '../hooks/useCohortConfig.js';
import { useCohortPrs } from '../hooks/useCohortPrs.js';
import { useCohortCommits } from '../hooks/useCohortCommits.js';
import { useRampUp } from '../hooks/useRampUp.js';
import { useRolling } from '../hooks/useRolling.js';
import { useDeveloperMonthly } from '../hooks/useDeveloperMonthly.js';
import { useContributors } from '../hooks/useContributors.js';
import { cohortTrendNarrative, rollingNarrative, METRIC_OPTIONS, METRIC_NARRATIVE_LABELS, CONCENTRATION_BASIS_OPTIONS, DEVELOPER_METRIC_OPTIONS } from '@shared/lib/narratives.js';
import type { MetricOption, DeveloperMetricOption } from '@shared/lib/narratives.js';
import { computeCohortInsights, computeRampUpInsights, computeRollingInsights } from '@shared/lib/insights.js';
import FilterBar from '../components/FilterBar.js';
import SharingPrompt from '../components/SharingPrompt.js';
import { useSharingEligibility } from '../hooks/useSharingStatus.js';
import CohortAreaChart from '@shared/components/charts/CohortAreaChart.js';
import { CohortDataTable } from '@shared/components/charts/CohortDataTable.js';
import RampUpLineChart from '@shared/components/charts/RampUpLineChart.js';
import { RampUpDataTable } from '@shared/components/charts/RampUpDataTable.js';
import RollingCards from '@shared/components/charts/RollingCards.js';
import NarrativeCard from '@shared/components/charts/NarrativeCard.js';
import { ContributorTable } from '../components/ContributorTable.js';
import { ExecutiveSummary } from '@shared/components/charts/ExecutiveSummary.js';
import { BeforeAfterComparison } from '@shared/components/charts/BeforeAfterComparison.js';
import { TeamDistributionChart } from '@shared/components/charts/TeamDistributionChart.js';
import { TeamDistributionTable } from '@shared/components/charts/TeamDistributionTable.js';
import { ScaryRealPanel } from '@shared/components/charts/ScaryRealPanel.js';
import { PrTurnaroundChart } from '@shared/components/charts/PrTurnaroundChart.js';
import { BotRatioChart } from '@shared/components/charts/BotRatioChart.js';
import { SectionHeader } from '@shared/components/SectionHeader.js';
import { HelpPanel } from '@shared/components/HelpPanel.js';
import { StatCalloutRow } from '@shared/components/charts/StatCalloutRow.js';
import { StatCalloutBox } from '@shared/components/charts/StatCalloutBox.js';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@shared/components/ui/collapsible.js';
import {
  DeveloperTrajectoryGrid,
  chooseDevLayout,
  type DeveloperWithRows,
} from '../components/charts/DeveloperTrajectoryGrid.js';
import { DeveloperTrajectoryList } from '../components/charts/DeveloperTrajectoryList.js';
import { DeveloperZoomModal } from '../components/charts/DeveloperZoomModal.js';
import type { TrackedRepo, ConcentrationBasis, ConcentrationMonthlyRow, HeadcountMonthlyRow, PeriodMetric, DeveloperMonthlyRow } from '@shared/types.js';
import type { ExportBundle } from '@shared/export-types.js';

export default function DashboardPage() {
  const {
    preset, setPreset,
    customRange, setCustomRange,
    startDate, endDate,
    repoIds, setRepoIds,
    tenureMode, setTenureMode,
    rollingGranularity, setRollingGranularity,
  } = useDashboardFilters();

  const [prMetric, setPrMetric] = useState<MetricOption>('totalCount');
  const [commitMetric, setCommitMetric] = useState<MetricOption>('totalCount');
  const [cohortPrView, setCohortPrView] = useState<'chart' | 'table'>('chart');
  const [cohortCommitView, setCohortCommitView] = useState<'chart' | 'table'>('chart');
  const [rampUpView, setRampUpView] = useState<'chart' | 'table'>('chart');
  const [concentrationBasis, setConcentrationBasis] = useState<ConcentrationBasis>('prs');
  const [concentrationView, setConcentrationView] = useState<'chart' | 'table'>('chart');

  // Phase 9.5: Contribution Patterns section state
  const [contribSectionOpen, setContribSectionOpen] = useState(false);  // D-07: collapsed by default
  const [contribHasExpandedThisSession, setContribHasExpandedThisSession] = useState(false);  // D-11
  const [contribMetric, setContribMetric] = useState<DeveloperMetricOption>('prCount');  // D-03 default
  const [zoomedDev, setZoomedDev] = useState<string | null>(null);  // D-05 modal state

  // Sharing prompt state
  const [sharingPromptOpen, setSharingPromptOpen] = useState(false);
  const [lastExportBundle, setLastExportBundle] = useState<ExportBundle | null>(null);
  const { refetch: refetchEligibility } = useSharingEligibility();

  async function handleExportComplete(bundle: ExportBundle) {
    setLastExportBundle(bundle);
    // Wait for increment-export to settle then fetch fresh eligibility from server
    const result = await refetchEligibility();
    if (result.data?.eligible) {
      setSharingPromptOpen(true);
    }
  }

  // Fetch AI marker date
  const { data: markerData } = useAiMarker();
  const markerDate = markerData?.date ?? null;

  // Fetch cohort config for dynamic chart labels
  const { config: cohortConfig } = useCohortConfig();
  const dynamicChartConfig = cohortConfig
    ? Object.fromEntries(cohortConfig.thresholds.map(t => [t.key, { label: t.label, color: t.color }]))
    : undefined;

  // Fetch cohort data
  const { data: prData = [], isFetching: prFetching, isError: prError } = useCohortPrs({
    startDate, endDate, tenureMode, repoIds,
  });
  const { data: commitData = [], isFetching: commitFetching, isError: commitError } = useCohortCommits({
    startDate, endDate, tenureMode, repoIds,
  });
  const { data: rampUpData = [], isFetching: rampUpFetching, isError: rampUpError } = useRampUp({
    tenureMode, repoIds, joinPeriodGranularity: 'quarter',
  });
  const { data: rollingData, isFetching: rollingFetching, isError: rollingError } = useRolling({
    granularity: rollingGranularity, repoIds,
  });

  // Fetch concentration, headcount, and period metrics data (Phase 9.4).
  // Pass startDate/endDate so period boundaries reflect the user's selected range
  // rather than the previous hardcoded '2020-01-01' fallback.
  // Backend treats empty repoIds as "all complete repos" — mirrors
  // useCohortPrs / useCohortCommits / useRampUp / useRolling behavior.
  // Don't gate on repoIds.length; otherwise the Team Distribution section
  // stays empty until the user manually opens the repo filter.
  const teamDistributionParams = { startDate, endDate, repoIds: repoIds.join(',') };
  const { data: concentrationData, isLoading: concentrationLoading, isError: concentrationError } = useQuery<ConcentrationMonthlyRow[]>({
    queryKey: ['analytics', 'concentration', startDate, endDate, repoIds],
    queryFn: async () => {
      const res = await fetch('/api/analytics/concentration?' + new URLSearchParams(teamDistributionParams));
      if (!res.ok) throw new Error('Failed to fetch concentration metrics');
      return res.json();
    },
  });
  const { data: headcountData, isLoading: headcountLoading, isError: headcountError } = useQuery<HeadcountMonthlyRow[]>({
    queryKey: ['analytics', 'headcount', startDate, endDate, repoIds],
    queryFn: async () => {
      const res = await fetch('/api/analytics/headcount?' + new URLSearchParams(teamDistributionParams));
      if (!res.ok) throw new Error('Failed to fetch headcount metrics');
      return res.json();
    },
  });
  const { data: periodMetricsData, isLoading: periodMetricsLoading, isError: periodMetricsError } = useQuery<PeriodMetric[]>({
    queryKey: ['analytics', 'period-metrics', startDate, endDate, repoIds],
    queryFn: async () => {
      const res = await fetch('/api/analytics/period-metrics?' + new URLSearchParams(teamDistributionParams));
      if (!res.ok) throw new Error('Failed to fetch period metrics');
      return res.json();
    },
  });

  // Check token + repos existence + seed mode
  const { data: trackedData, isLoading: reposLoading } = useQuery<{ repos: TrackedRepo[] }>({
    queryKey: ['repos', 'tracked'],
    queryFn: () => fetch('/api/repos').then((r) => r.json()),
  });
  const { data: tokenData } = useQuery<{ configured: boolean }>({
    queryKey: ['settings', 'token'],
    queryFn: () => fetch('/api/settings/token').then((r) => r.json()),
  });
  const { data: healthData } = useQuery<{ isSeedDb: boolean }>({
    queryKey: ['health'],
    queryFn: () => fetch('/api/health').then((r) => r.json()),
    staleTime: Infinity,
  });

  const trackedRepos = trackedData?.repos ?? [];
  const isSeedDb = healthData?.isSeedDb ?? false;
  const hasToken = isSeedDb || (tokenData?.configured ?? true); // seed DB doesn't need a real token
  const anyFetching = prFetching || commitFetching || rampUpFetching || rollingFetching;
  const anyError = prError || commitError || rampUpError || rollingError
    || concentrationError || headcountError || periodMetricsError;

  // Compute insights for existing sections
  const prInsights = computeCohortInsights(prData, prMetric, 'pr');
  const commitInsights = computeCohortInsights(commitData, commitMetric, 'commit');
  const rampUpInsights = computeRampUpInsights(rampUpData, !!markerDate);
  const rollingInsights = computeRollingInsights(rollingData);

  // Phase 9.5: Contribution Patterns data fetching + computation.
  // Hook key includes [startDate, endDate, repoIds] so cache auto-refetches
  // when the dashboard filter changes (D-02/D-25).
  const developerMonthlyQuery = useDeveloperMonthly({ startDate, endDate, repoIds });
  const developerRows = developerMonthlyQuery.data ?? [];

  // Phase 9.5: Pull tenure + cohort metadata from useContributors with
  // tenureMode='global' so the same firstCommitAt / cohort keys flow into
  // per-dev mini-chart sorting and cohort-mean overlays. tenureMode='global'
  // is required for stable cross-repo cohorts.
  // NOTE: This invocation is NEW in Phase 9.5 — DashboardPage did NOT call
  // useContributors before this plan.
  const contributorsQuery = useContributors({
    startDate, endDate, tenureMode: 'global', repoIds,
  });

  // D-02: Active-dev count = distinct authorLogins in the response
  const distinctAuthors = Array.from(new Set(developerRows.map(r => r.authorLogin)));
  const activeDevsCount = distinctAuthors.length;
  const layoutMode = chooseDevLayout(activeDevsCount);

  // Bucket rows by author. tenureJoinedAt sourced from contributorsQuery.
  // cohortKey defaults to 'mid' when contributor lookup is missing.
  const developersWithRows: DeveloperWithRows[] = distinctAuthors.map(login => {
    const rows = developerRows.filter(r => r.authorLogin === login);
    const contrib = (contributorsQuery.data ?? []).find(
      (c: { authorLogin: string }) => c.authorLogin === login,
    );
    const tenureJoinedAt = (contrib as { firstCommitAt?: string } | undefined)?.firstCommitAt ?? null;
    const cohortKey = (contrib as { cohort?: string } | undefined)?.cohort ?? 'mid';
    return { authorLogin: login, tenureJoinedAt, cohortKey, rows };
  });

  // Sort by tenure descending (newest joined first per D-06).
  developersWithRows.sort((a, b) =>
    (a.tenureJoinedAt ?? '9999').localeCompare(b.tenureJoinedAt ?? '9999'),
  );

  // Cohort-mean overlay — group rows by (cohortKey, month) and average the active metric.
  const cohortMeanByMonthAndCohort = computeCohortMeans(developersWithRows, contribMetric);

  // Cohort-band for the modal — computed only for the zoomed dev's cohort (D-05).
  const zoomedDevObj = zoomedDev
    ? developersWithRows.find(d => d.authorLogin === zoomedDev) ?? null
    : null;
  const cohortBandByMonth = zoomedDevObj
    ? computeCohortBand(developersWithRows, zoomedDevObj.cohortKey, contribMetric)
    : new Map<string, { p25: number | null; p75: number | null }>();
  const cohortMeanForZoom = zoomedDevObj
    ? (cohortMeanByMonthAndCohort.get(zoomedDevObj.cohortKey) ?? new Map<string, number | null>())
    : new Map<string, number | null>();

  // AI marker month — markerDate already in scope (line 85). Slice to 'YYYY-MM'.
  const aiMarkerMonth = markerDate ? markerDate.slice(0, 7) : null;

  // Filter concentration data by selected basis and compute stat callout values
  const filteredConcentration: ConcentrationMonthlyRow[] = (concentrationData ?? []).filter(
    (r: ConcentrationMonthlyRow) => r.basis === concentrationBasis,
  );

  // Sort by month asc; take latest and prior-month for delta computation
  const sortedConc = [...filteredConcentration].sort((a, b) => a.month.localeCompare(b.month));
  const latestConc = sortedConc[sortedConc.length - 1] ?? null;
  const priorConc = sortedConc[sortedConc.length - 2] ?? null;

  const fmtPct = (v: number | null) => (v == null ? '--' : `${Math.round(v)}%`);
  const fmtInt = (v: number | null) => (v == null ? '--' : String(Math.round(v)));

  const busFactor = latestConc?.busFactor ?? null;
  const priorBusFactor = priorConc?.busFactor ?? null;
  const busDelta = priorBusFactor != null && busFactor != null
    ? `${busFactor - priorBusFactor >= 0 ? '+' : ''}${busFactor - priorBusFactor} vs prior month`
    : undefined;
  const busDir: 'up' | 'down' | 'neutral' | undefined = busDelta == null
    ? undefined
    : busFactor! > priorBusFactor! ? 'up' : busFactor! < priorBusFactor! ? 'down' : 'neutral';

  const top1Share = latestConc?.top1Share ?? null;
  const priorTop1 = priorConc?.top1Share ?? null;
  const topDeltaPp = priorTop1 != null && top1Share != null ? top1Share - priorTop1 : null;
  const topDelta = topDeltaPp != null
    ? `${topDeltaPp >= 0 ? '+' : ''}${Math.round(topDeltaPp)}pp`
    : undefined;
  // lowerIsBetter: decreasing share = up/emerald
  const topDir: 'up' | 'down' | 'neutral' | undefined = topDeltaPp == null
    ? undefined
    : topDeltaPp < 0 ? 'up' : topDeltaPp > 0 ? 'down' : 'neutral';

  const activeDevs = latestConc?.activeDevs ?? null;
  const priorDevs = priorConc?.activeDevs ?? null;
  const devsDeltaNum = priorDevs != null && activeDevs != null ? activeDevs - priorDevs : null;
  const devsDelta = devsDeltaNum != null
    ? `${devsDeltaNum >= 0 ? '+' : ''}${devsDeltaNum} vs prior month`
    : undefined;
  const devsDir: 'up' | 'down' | 'neutral' | undefined = devsDeltaNum == null
    ? undefined
    : devsDeltaNum > 0 ? 'up' : devsDeltaNum < 0 ? 'down' : 'neutral';

  // Auto-generate concentration narrative
  const concentrationNarrative = (() => {
    if (sortedConc.length < 2) return '';
    const first = sortedConc[0];
    const last = sortedConc[sortedConc.length - 1];
    const parts: string[] = [];
    if (first.top1Share != null && last.top1Share != null) {
      const dir = last.top1Share < first.top1Share ? 'decreased' : 'increased';
      parts.push(`Top contributor share ${dir} from ${Math.round(first.top1Share)}% to ${Math.round(last.top1Share)}% (${concentrationBasis} basis)`);
    }
    if (first.busFactor != null && last.busFactor != null && first.busFactor !== last.busFactor) {
      const dir = last.busFactor > first.busFactor ? 'improved' : 'decreased';
      parts.push(`bus factor ${dir} from ${first.busFactor} to ${last.busFactor} developers`);
    }
    if (first.activeDevs !== last.activeDevs) {
      const dir = last.activeDevs > first.activeDevs ? 'grew' : 'shrank';
      parts.push(`active team ${dir} from ${first.activeDevs} to ${last.activeDevs} contributors`);
    }
    return parts.length > 0 ? parts.join('; ') + '.' : '';
  })();

  // Show empty state: no token configured
  if (!reposLoading && tokenData && !hasToken) {
    return (
      <>
        <FilterBar
          preset={preset} setPreset={setPreset}
          customRange={customRange} setCustomRange={setCustomRange}
          repoIds={repoIds} setRepoIds={setRepoIds}
          tenureMode={tenureMode} setTenureMode={setTenureMode}
          filters={{ preset, startDate, endDate, repoIds, tenureMode, rollingGranularity }}
          onExportComplete={handleExportComplete}
        />
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Card>
            <CardHeader>
              <CardTitle>No data yet</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Collect data from your tracked repos to see contribution trends here. Go to Collection to get started.
              </p>
              <a
                href="#/settings"
                className="mt-4 inline-flex items-center text-sm text-primary hover:underline"
              >
                Go to Settings
              </a>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  // Show empty state: no repos tracked
  if (!reposLoading && trackedRepos.length === 0) {
    return (
      <>
        <FilterBar
          preset={preset} setPreset={setPreset}
          customRange={customRange} setCustomRange={setCustomRange}
          repoIds={repoIds} setRepoIds={setRepoIds}
          tenureMode={tenureMode} setTenureMode={setTenureMode}
          filters={{ preset, startDate, endDate, repoIds, tenureMode, rollingGranularity }}
          onExportComplete={handleExportComplete}
        />
        <div className="max-w-6xl mx-auto px-6 py-8">
          <Card>
            <CardHeader>
              <CardTitle>No repos tracked</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Add repos on the Repos page, then collect data to see trends.
              </p>
              <a
                href="#/repos"
                className="mt-4 inline-flex items-center text-sm text-primary hover:underline"
              >
                Go to Repos
              </a>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <FilterBar
        preset={preset} setPreset={setPreset}
        customRange={customRange} setCustomRange={setCustomRange}
        repoIds={repoIds} setRepoIds={setRepoIds}
        tenureMode={tenureMode} setTenureMode={setTenureMode}
        filters={{ preset, startDate, endDate, repoIds, tenureMode, rollingGranularity }}
        onExportComplete={handleExportComplete}
      />
      <SharingPrompt
        open={sharingPromptOpen}
        onOpenChange={setSharingPromptOpen}
        exportBundle={lastExportBundle}
      />
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Seed data banner */}
        {isSeedDb && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            Viewing synthetic seed data. Charts show simulated contribution patterns, not real GitHub data.
          </div>
        )}

        {/* Repo context */}
        {trackedRepos.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Analyzing: {trackedRepos.map((r) => r.fullName).join(', ')}
          </div>
        )}

        {/* Screen reader loading announcement */}
        <div aria-live="polite" className="sr-only">
          {anyFetching ? 'Loading dashboard data...' : ''}
        </div>

        {/* Error state */}
        {anyError && (
          <Card className="border-destructive">
            <CardContent className="p-4">
              <p className="text-sm text-destructive">
                Could not load chart data. Check that the server is running, then refresh the page.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Section 1: Executive Summary (D-11) */}
        <ExecutiveSummary startDate={startDate} endDate={endDate} repoIds={repoIds} />

        {/* Section 2: Team Distribution (D-01..D-12) */}
        <section>
          <SectionHeader title="Team Distribution" scope="filtered" />
          <div className="mt-4 space-y-6">

            {/* Subsection 2a: Concentration Risk */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-medium">Concentration Risk</h3>
                <div className="flex items-center gap-2">
                  <Tabs value={concentrationBasis} onValueChange={(v) => setConcentrationBasis(v as ConcentrationBasis)}>
                    <TabsList className="h-8 gap-1">
                      {CONCENTRATION_BASIS_OPTIONS.map(opt => (
                        <TabsTrigger key={opt.value} value={opt.value} className="text-xs px-3 py-1 data-active:bg-primary data-active:text-primary-foreground">
                          {opt.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  <Tabs value={concentrationView} onValueChange={(v) => setConcentrationView(v as 'chart' | 'table')}>
                    <TabsList className="h-7 gap-0 bg-transparent border border-border rounded-md p-0">
                      <TabsTrigger value="chart" className="h-full px-2 py-0.5 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view"><BarChart3 className="h-3.5 w-3.5" /></TabsTrigger>
                      <TabsTrigger value="table" className="h-full px-2 py-0.5 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view"><TableProperties className="h-3.5 w-3.5" /></TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </div>
              <StatCalloutRow>
                <StatCalloutBox
                  label="Bus Factor"
                  value={fmtInt(busFactor) + (busFactor != null ? ' devs' : '')}
                  delta={busDelta}
                  deltaDir={busDir}
                  isLoading={concentrationLoading && filteredConcentration.length === 0}
                />
                <StatCalloutBox
                  label="Top Contributor Share"
                  value={fmtPct(top1Share)}
                  delta={topDelta}
                  deltaDir={topDir}
                  isLoading={concentrationLoading && filteredConcentration.length === 0}
                />
                <StatCalloutBox
                  label="Active Developers"
                  value={fmtInt(activeDevs)}
                  delta={devsDelta}
                  deltaDir={devsDir}
                  isLoading={concentrationLoading && filteredConcentration.length === 0}
                />
              </StatCalloutRow>
              {concentrationNarrative && (
                <NarrativeCard text={concentrationNarrative} />
              )}
              {concentrationView === 'chart'
                ? <TeamDistributionChart data={filteredConcentration} aiMarkerDate={markerDate} isLoading={concentrationLoading} />
                : <TeamDistributionTable data={filteredConcentration} />
              }
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
                <p className="mt-2">
                  Use Settings to configure the AI adoption marker date. The vertical marker line on
                  charts lets you visually compare concentration patterns before and after tool adoption.
                </p>
              </HelpPanel>
            </div>

            {/* Subsection 2b: Output per Developer */}
            <div>
              <h3 className="text-base font-medium mb-3">Output per Developer</h3>
              <ScaryRealPanel data={headcountData ?? []} aiMarkerDate={markerDate} isLoading={headcountLoading} />
              <HelpPanel>
                <p>
                  This panel shows the same PR volume data from two perspectives. The left chart shows
                  total PRs per month, which can look alarming during team changes -- losing contributors
                  naturally reduces total output. The right chart normalizes by team size, showing PRs per
                  active developer alongside the number of active contributors.
                </p>
                <p className="mt-2">
                  When the team shrinks but PRs-per-developer stays flat (or rises), it means the
                  remaining team absorbed the workload. When the team grows and PRs-per-developer holds
                  steady, it means new contributors are productive, not just present.
                </p>
                <p className="mt-2">
                  An active developer is anyone with at least one commit or PR (created or merged) in a
                  given month, excluding bots. This is the most inclusive definition -- it captures both
                  commit-to-main workflows and PR-based review workflows.
                </p>
              </HelpPanel>
            </div>

          </div>
        </section>

        {/* Phase 9.5: Contribution Patterns section (D-07/D-08/D-09/D-10/D-11) */}
        <section>
          <Collapsible
            open={contribSectionOpen}
            onOpenChange={(next) => {
              setContribSectionOpen(next);
              if (next && !contribHasExpandedThisSession) {
                setContribHasExpandedThisSession(true);
              }
            }}
          >
            <CollapsibleTrigger className="w-full flex items-center justify-between py-2 hover:bg-muted/30 rounded-md transition-colors">
              <div className="flex items-center gap-2">
                {contribSectionOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                <div className="text-left">
                  <h2 className="text-lg font-semibold tracking-tight">Contribution Patterns</h2>
                  <p className="text-sm text-muted-foreground">
                    Per-developer monthly trajectories — for understanding how team contribution shapes shift over time
                  </p>
                </div>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-4 space-y-4">
                {/*
                  HelpPanel — D-10 verbatim copy.
                  D-11 mechanism: HelpPanel's internal useState(defaultOpen) captures
                  the prop value ONCE on first render. Subsequent prop changes are
                  intentionally ignored, preserving the user's manual collapse choice.
                  contribHasExpandedThisSession therefore only matters on the FIRST
                  mount of HelpPanel within this section. After that, HelpPanel
                  manages its own open/closed state independently.
                */}
                <HelpPanel defaultOpen={!contribHasExpandedThisSession}>
                  <p>
                    This section shows how each contributor's monthly output evolves over time — PR count, commit count, and per-commit size signals — alongside a cohort-average overlay so each chart is anchored to its peer group. It is designed for understanding team-wide patterns in how contributions change, especially around AI tool adoption, not for measuring individual productivity.
                  </p>
                  <p className="mt-2">
                    Charts are sorted by tenure, never by output volume. There is no "good" or "bad" trajectory shape — different roles, project types, and personal styles produce different patterns. The cohort-average dashed line shows what a typical contributor at the same tenure looks like in the same months; clicking any chart opens a larger view with the full cohort 25th-75th percentile band, so you can see whether a pattern is unusual or within normal team variance.
                  </p>
                  <p className="mt-2">
                    What to look for: changes that show up across most cohort members at once. AI marker date alignment, post-AI commit size shifts, ramp-up shape for newer joiners. Patterns at the cohort level reveal team dynamics; differences at the individual level mostly reflect role/project variation, not effort or skill.
                  </p>
                  <p className="mt-2">
                    The PRs / Commits / Lines per commit / Files per commit tabs surface different contribution shapes. Lines per commit and files per commit are useful for spotting AI-assisted commit-shape shifts (smaller commits, narrower file scope) but are influenced by refactors, generated code, and personal commit hygiene — interpret with caution.
                  </p>
                  <p className="mt-2">
                    Use Settings to configure cohort thresholds and the AI adoption marker date. Bot-detected accounts are excluded automatically.
                  </p>
                </HelpPanel>

                {developersWithRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active contributors in the selected date range.</p>
                ) : (
                  <>
                    {/* Metric tabs — D-03 verbatim labels */}
                    <div className="flex items-center justify-end">
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

                    {/* Adaptive Layout A or C (D-01) */}
                    {layoutMode === 'grid' ? (
                      <DeveloperTrajectoryGrid
                        developers={developersWithRows}
                        metric={contribMetric}
                        aiMarkerMonth={aiMarkerMonth}
                        cohortMeanByMonthAndCohort={cohortMeanByMonthAndCohort}
                        onChartClick={setZoomedDev}
                        isLoading={developerMonthlyQuery.isLoading}
                      />
                    ) : (
                      <DeveloperTrajectoryList
                        developers={developersWithRows}
                        metric={contribMetric}
                        aiMarkerMonth={aiMarkerMonth}
                        cohortMeanByMonthAndCohort={cohortMeanByMonthAndCohort}
                        onChartClick={setZoomedDev}
                        isLoading={developerMonthlyQuery.isLoading}
                      />
                    )}
                  </>
                )}

                {/* Click-to-zoom modal (D-05) */}
                {zoomedDevObj && (
                  <DeveloperZoomModal
                    open={zoomedDev !== null}
                    onOpenChange={(open) => { if (!open) setZoomedDev(null); }}
                    authorLogin={zoomedDevObj.authorLogin}
                    rows={zoomedDevObj.rows}
                    cohortMeanByMonth={cohortMeanForZoom}
                    cohortBandByMonth={cohortBandByMonth}
                    aiMarkerMonth={aiMarkerMonth}
                    initialMetric={contribMetric}
                  />
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>

        {/* Section 3: Cohort Trends (D-11) */}
        <section>
          <SectionHeader title="Cohort Trends" scope="filtered" />
          <div className="mt-4 space-y-6">
            {/* PR Size Trends subsection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-medium">PR Size Trends</h3>
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
                      <TabsTrigger value="chart" className="h-full px-2 py-0.5 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view"><BarChart3 className="h-3.5 w-3.5" /></TabsTrigger>
                      <TabsTrigger value="table" className="h-full px-2 py-0.5 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view"><TableProperties className="h-3.5 w-3.5" /></TabsTrigger>
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
                    isLoading={prFetching && prData.length === 0}
                  />
                ))}
              </StatCalloutRow>
              <div className="mt-4">
                {cohortPrView === 'chart' ? (
                  <>
                    <NarrativeCard
                      text={cohortTrendNarrative(prData, prMetric, METRIC_NARRATIVE_LABELS[prMetric].pr)}
                      isFetching={prFetching && prData.length === 0}
                    />
                    <CohortAreaChart
                      data={prData}
                      metric={prMetric}
                      title="PR Count by Cohort"
                      aiMarkerDate={markerDate}
                      isFetching={prFetching}
                      chartConfig={dynamicChartConfig}
                    />
                  </>
                ) : (
                  <CohortDataTable
                    data={prData}
                    metric={prMetric}
                    isFetching={prFetching}
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
                  You can switch the metric with the "Count / Lines Added / Lines Deleted /
                  Files Changed" tabs above. To adjust cohort boundaries, go to{' '}
                  <a href="#/settings" className="underline hover:text-foreground">Settings &gt; Cohort Configuration</a>.
                </p>
                <p className="mt-2">
                  When Per-repo cohort mode is active, a contributor's tenure resets to day 1 for each repo
                  they join — so the same person may appear as 'New' in a repo they recently joined and
                  'Senior' in one they've contributed to for years. Switch to Global mode to measure tenure
                  from their earliest commit across all repos.
                </p>
              </HelpPanel>
            </div>

            {/* Commit Size Trends subsection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-medium">Commit Size Trends</h3>
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
                      <TabsTrigger value="chart" className="h-full px-2 py-0.5 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view"><BarChart3 className="h-3.5 w-3.5" /></TabsTrigger>
                      <TabsTrigger value="table" className="h-full px-2 py-0.5 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view"><TableProperties className="h-3.5 w-3.5" /></TabsTrigger>
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
                    isLoading={commitFetching && commitData.length === 0}
                  />
                ))}
              </StatCalloutRow>
              <div className="mt-4">
                {cohortCommitView === 'chart' ? (
                  <>
                    <NarrativeCard
                      text={cohortTrendNarrative(commitData, commitMetric, METRIC_NARRATIVE_LABELS[commitMetric].commit)}
                      isFetching={commitFetching && commitData.length === 0}
                    />
                    <CohortAreaChart
                      data={commitData}
                      metric={commitMetric}
                      title="Commit Count by Cohort"
                      aiMarkerDate={markerDate}
                      isFetching={commitFetching}
                      chartConfig={dynamicChartConfig}
                    />
                  </>
                ) : (
                  <CohortDataTable
                    data={commitData}
                    metric={commitMetric}
                    isFetching={commitFetching}
                    chartConfig={dynamicChartConfig}
                  />
                )}
              </div>
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
                To adjust cohort date boundaries, go to{' '}
                <a href="#/settings" className="underline hover:text-foreground">Settings &gt; Cohort Configuration</a>.
              </p>
              <p className="mt-2">
                When Per-repo cohort mode is active, a contributor's tenure resets to day 1 for each repo
                they join — so the same person may appear as 'New' in a repo they recently joined and
                'Senior' in one they've contributed to for years. Switch to Global mode to measure tenure
                from their earliest commit across all repos.
              </p>
            </HelpPanel>
          </div>
        </section>

        {/* Section 4: Ramp-Up Curves (D-11) */}
        <section>
          <div className="flex items-center justify-between">
            <SectionHeader title="Ramp-Up Curves" scope="independent" />
            <Tabs value={rampUpView} onValueChange={(v) => setRampUpView(v as 'chart' | 'table')}>
              <TabsList className="h-7 gap-0 bg-transparent border border-border rounded-md p-0">
                <TabsTrigger value="chart" className="h-full px-2 py-0.5 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view"><BarChart3 className="h-3.5 w-3.5" /></TabsTrigger>
                <TabsTrigger value="table" className="h-full px-2 py-0.5 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view"><TableProperties className="h-3.5 w-3.5" /></TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="mt-4">
            <StatCalloutRow>
              {rampUpInsights.map((insight) => (
                <StatCalloutBox
                  key={insight.label}
                  label={insight.label}
                  value={insight.value}
                  delta={insight.delta}
                  deltaDir={insight.deltaDir}
                  isLoading={rampUpFetching && rampUpData.length === 0}
                />
              ))}
            </StatCalloutRow>
            <div className="mt-4">
              {rampUpView === 'chart' ? (
                <RampUpLineChart
                  data={rampUpData}
                  isFetching={rampUpFetching}
                />
              ) : (
                <RampUpDataTable
                  data={rampUpData}
                  isFetching={rampUpFetching}
                />
              )}
            </div>
            <HelpPanel>
              <p>
                This section shows how quickly new contributors reached meaningful contribution
                sizes after joining, grouped by the quarter they made their first commit.
                The x-axis is weeks from first commit, and the y-axis is the average number
                of lines changed per commit in that week.
              </p>
              <p className="mt-2">
                Each line represents a cohort of developers who joined in the same quarter.
                Steeper early rises mean contributors ramped up faster, producing
                larger changes sooner. A flat early period followed by a sharp rise suggests
                an onboarding ramp that took several weeks before developers felt confident.
              </p>
              <p className="mt-2">
                If cohorts who joined after your AI adoption date show steeper early ramps
                than earlier cohorts, that is a concrete signal that AI tooling is compressing
                the time-to-productivity for new contributors. For example: if your 2025-Q1
                cohort reached 100 lines/week in week 3 while your 2024-Q3 cohort took 6
                weeks, that is a meaningful shift worth noting.
              </p>
              <p className="mt-2">
                The ramp-up window is fixed at 12 weeks. Cohort assignment uses each
                contributor's first commit date in each repo. To adjust cohort boundaries
                (e.g., what counts as "new"), go to{' '}
                <a href="#/settings" className="underline hover:text-foreground">Settings &gt; Cohort Configuration</a>.
              </p>
            </HelpPanel>
          </div>
        </section>

        {/* Section 5: Before/After Comparison (D-11) */}
        <BeforeAfterComparison periodMetrics={periodMetricsData ?? null} isLoading={periodMetricsLoading} />

        {/* Section 6: PR Turnaround (D-11) */}
        <PrTurnaroundChart startDate={startDate} endDate={endDate} repoIds={repoIds} />

        {/* Section 7: Rolling Comparisons (D-11) */}
        <section>
          <SectionHeader title="Rolling Comparisons" scope="independent" />
          <div className="mt-4">
            <StatCalloutRow>
              {rollingInsights.map((insight) => (
                <StatCalloutBox
                  key={insight.label}
                  label={insight.label}
                  value={insight.value}
                  delta={insight.delta}
                  deltaDir={insight.deltaDir}
                  isLoading={rollingFetching && !rollingData}
                />
              ))}
            </StatCalloutRow>
            <div className="mt-4">
              <NarrativeCard
                text={rollingData ? rollingNarrative(rollingData, 'prFrequency') : ''}
                isFetching={rollingFetching && !rollingData}
              />
              <RollingCards
                data={rollingData}
                isFetching={rollingFetching}
                granularity={rollingGranularity}
                onGranularityChange={setRollingGranularity}
              />
            </div>
            <HelpPanel>
              The date range and repo filters above affect all sections marked with the filter scope badge. Rolling comparisons show the current period versus the immediately prior period of the same length. Use the Month / Quarter toggle to change the comparison window.
            </HelpPanel>
          </div>
        </section>

        {/* Section 8: Bot vs Human Ratio (D-11) */}
        <BotRatioChart startDate={startDate} endDate={endDate} repoIds={repoIds} />

        {/* Section 9: Contributor Table (D-11) */}
        <section>
          <ContributorTable
            startDate={startDate}
            endDate={endDate}
            tenureMode={tenureMode}
            repoIds={repoIds}
            aiMarkerDate={markerDate}
          />
          <HelpPanel>
            <p>
              This table shows contribution totals for each unique contributor detected in
              your selected repos and date range, grouped by their tenure cohort at the
              time of contribution. Cohorts are assigned based on how long each contributor
              had been active when they made each commit or PR.
            </p>
            <p className="mt-2">
              The Pre-AI and Post-AI columns compare activity from before and after the
              AI adoption date configured in Settings. If no AI adoption date is set, these
              columns will be empty. Go to{' '}
              <a href="#/settings" className="underline hover:text-foreground">Settings</a>{' '}
              to configure it.
            </p>
            <p className="mt-2">
              Sort any column to explore the data: sort by "Change" on commits to find
              contributors whose output shifted most after AI adoption. Because cohorts
              group contributors by experience level rather than naming individuals, this
              view is best used for understanding team-wide patterns rather than evaluating
              specific people.
            </p>
            <p className="mt-2">
              This view shows how contribution patterns shifted across your team, not individual performance scores. No default sort is applied to change columns;
              the default sort is total commits, which reflects overall activity level.
            </p>
            <p className="mt-2">
              To adjust cohort boundaries, go to{' '}
              <a href="#/settings" className="underline hover:text-foreground">Settings &gt; Cohort Configuration</a>.
            </p>
            <p className="mt-2">
              In Per-repo mode, each row represents a specific contributor in a specific repo. An author
              who contributes to three repos appears as three rows, each with tenure and metrics scoped
              to that repo. When you filter to a single repo, the table collapses back to one row per
              contributor.
            </p>
          </HelpPanel>
        </section>
      </div>
    </>
  );
}

// ─── Phase 9.5 helpers ─────────────────────────────────────────────────────────
// Cohort mean/band computation per metric. Used by the Contribution Patterns
// section to overlay cohort context on each per-developer mini-chart.

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
  const buckets = new Map<string, Map<string, number[]>>();  // cohortKey -> month -> values
  for (const dev of devs) {
    if (!buckets.has(dev.cohortKey)) buckets.set(dev.cohortKey, new Map());
    for (const r of dev.rows) {
      const v = metricValue(r, metric);
      if (v === null) continue;
      const monthMap = buckets.get(dev.cohortKey)!;
      if (!monthMap.has(r.month)) monthMap.set(r.month, []);
      monthMap.get(r.month)!.push(v);
    }
  }
  for (const [cohortKey, monthMap] of buckets) {
    const result = new Map<string, number | null>();
    for (const [month, values] of monthMap) {
      result.set(
        month,
        values.length > 0 ? values.reduce((s, x) => s + x, 0) / values.length : null,
      );
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
