import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDashboardFilters } from '../hooks/useDashboardFilters.js';
import { useAiMarker } from '../hooks/useAiMarker.js';
import { useCohortConfig } from '../hooks/useCohortConfig.js';
import { useCohortPrs } from '../hooks/useCohortPrs.js';
import { useCohortCommits } from '../hooks/useCohortCommits.js';
import { useRampUp } from '../hooks/useRampUp.js';
import { useRolling } from '../hooks/useRolling.js';
import { cohortTrendNarrative, rollingNarrative } from '../lib/narratives.js';
import { computeCohortInsights, computeRampUpInsights, computeRollingInsights } from '../lib/insights.js';
import FilterBar from '../components/FilterBar.js';
import CohortAreaChart from '../components/charts/CohortAreaChart.js';
import RampUpLineChart from '../components/charts/RampUpLineChart.js';
import RollingCards from '../components/charts/RollingCards.js';
import NarrativeCard from '../components/charts/NarrativeCard.js';
import { ContributorTable } from '../components/ContributorTable.js';
import { ExecutiveSummary } from '../components/charts/ExecutiveSummary.js';
import { BeforeAfterComparison } from '../components/charts/BeforeAfterComparison.js';
import { PrTurnaroundChart } from '../components/charts/PrTurnaroundChart.js';
import { BotRatioChart } from '../components/charts/BotRatioChart.js';
import { SectionHeader } from '../components/SectionHeader.js';
import { HelpPanel } from '../components/HelpPanel.js';
import { StatCalloutRow } from '../components/charts/StatCalloutRow.js';
import { StatCalloutBox } from '../components/charts/StatCalloutBox.js';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs.js';
import type { TrackedRepo } from '@shared/types.js';

type MetricOption = 'totalCount' | 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged';

const METRIC_OPTIONS: { label: string; value: MetricOption }[] = [
  { label: 'Count', value: 'totalCount' },
  { label: 'Lines Added', value: 'avgLinesAdded' },
  { label: 'Lines Deleted', value: 'avgLinesDeleted' },
  { label: 'Files Changed', value: 'avgFilesChanged' },
];

const METRIC_NARRATIVE_LABELS: Record<MetricOption, { pr: string; commit: string }> = {
  totalCount: { pr: 'PR volume', commit: 'Commit volume' },
  avgLinesAdded: { pr: 'Avg lines added per PR', commit: 'Avg lines added per commit' },
  avgLinesDeleted: { pr: 'Avg lines deleted per PR', commit: 'Avg lines deleted per commit' },
  avgFilesChanged: { pr: 'Avg files changed per PR', commit: 'Avg files changed per commit' },
};

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
  const hasToken = tokenData?.configured ?? true; // assume configured until we know
  const anyFetching = prFetching || commitFetching || rampUpFetching || rollingFetching;
  const anyError = prError || commitError || rampUpError || rollingError;

  // Compute insights for existing sections
  const prInsights = computeCohortInsights(prData, prMetric, 'pr');
  const commitInsights = computeCohortInsights(commitData, commitMetric, 'commit');
  const rampUpInsights = computeRampUpInsights(rampUpData, !!markerDate);
  const rollingInsights = computeRollingInsights(rollingData);

  // Show empty state: no token configured
  if (!reposLoading && tokenData && !hasToken) {
    return (
      <>
        <FilterBar
          preset={preset} setPreset={setPreset}
          customRange={customRange} setCustomRange={setCustomRange}
          repoIds={repoIds} setRepoIds={setRepoIds}
          tenureMode={tenureMode} setTenureMode={setTenureMode}
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
      />
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Seed data banner */}
        {isSeedDb && (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            Viewing synthetic seed data — charts show simulated contribution patterns, not real GitHub data.
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

        {/* Section 2: Cohort Trends (D-11) */}
        <section>
          <SectionHeader title="Cohort Trends" scope="filtered" />
          <div className="mt-4 space-y-6">
            {/* PR Size Trends subsection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-medium">PR Size Trends</h3>
                <Tabs value={prMetric} onValueChange={(v) => setPrMetric(v as MetricOption)}>
                  <TabsList className="h-8 gap-1">
                    {METRIC_OPTIONS.map(({ label, value }) => (
                      <TabsTrigger key={value} value={value} className="text-xs px-3 py-1">
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
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
              </div>
            </div>

            {/* Commit Size Trends subsection */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-medium">Commit Size Trends</h3>
                <Tabs value={commitMetric} onValueChange={(v) => setCommitMetric(v as MetricOption)}>
                  <TabsList className="h-8 gap-1">
                    {METRIC_OPTIONS.map(({ label, value }) => (
                      <TabsTrigger key={value} value={value} className="text-xs px-3 py-1">
                        {label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
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
              </div>
            </div>

            <HelpPanel>
              Contributors are grouped by how long they'd been active in the repo at the time of each commit. 'New' means within the first tenure threshold months of their first commit; 'Growing' is between the first and second thresholds; 'Senior' is beyond the second threshold. Global mode uses each author's earliest commit across all tracked repos. Per-repo mode measures tenure independently within each repo.
            </HelpPanel>
          </div>
        </section>

        {/* Section 3: Ramp-Up Curves (D-11) */}
        <section>
          <SectionHeader title="Ramp-Up Curves" scope="independent" />
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
              <RampUpLineChart
                data={rampUpData}
                isFetching={rampUpFetching}
              />
            </div>
            <HelpPanel>
              The ramp-up chart shows how quickly contributors reach meaningful contribution sizes after their first commit. Each line represents a group of contributors by the period they joined. Faster ramp-up in more recent periods may reflect AI tool adoption accelerating onboarding.
            </HelpPanel>
          </div>
        </section>

        {/* Section 4: Before/After Comparison (D-11) */}
        <BeforeAfterComparison repoIds={repoIds} aiMarkerDate={markerDate} />

        {/* Section 5: PR Turnaround (D-11) */}
        <PrTurnaroundChart startDate={startDate} endDate={endDate} repoIds={repoIds} />

        {/* Section 6: Rolling Comparisons (D-11) */}
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

        {/* Section 7: Bot vs Human Ratio (D-11) */}
        <BotRatioChart startDate={startDate} endDate={endDate} repoIds={repoIds} />

        {/* Section 8: Contributor Table (D-11) */}
        <section>
          <ContributorTable
            startDate={startDate}
            endDate={endDate}
            tenureMode={tenureMode}
            repoIds={repoIds}
          />
        </section>
      </div>
    </>
  );
}
