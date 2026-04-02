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
              <HelpPanel>
                <p>
                  This chart shows how the average size of pull requests has changed over time,
                  grouped by how long contributors had been active when they opened each PR.
                  The x-axis is time (by month), and the y-axis shows the selected metric —
                  PR count, average lines added, lines deleted, or files changed.
                </p>
                <p className="mt-2">
                  Each cohort line (new devs, mid-tenure, senior) tells a different story.
                  If you see the new-dev line rising steeply after your AI adoption date, that
                  suggests newer contributors are taking on larger or more frequent PRs — a
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
                  Files Changed" tabs above the chart. To adjust cohort boundaries, go to{' '}
                  <a href="#/settings" className="underline hover:text-foreground">Settings &gt; Cohort Configuration</a>.
                </p>
              </HelpPanel>
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
              <p>
                This chart shows how the average size of individual commits has changed over
                time, broken down by contributor tenure cohort. The y-axis reflects the
                selected metric — commit count, average lines added, lines deleted, or files
                changed per commit.
              </p>
              <p className="mt-2">
                Commit size is a different signal from PR size: smaller commits often reflect
                more iterative development practices, while larger commits may indicate batch
                work or infrequent saves. AI coding assistants tend to produce larger
                individual changes, so an increase in average lines per commit after your
                AI adoption date — especially in the new-dev cohort — can be an early
                adoption signal.
              </p>
              <p className="mt-2">
                If the new-dev cohort line rises faster than senior contributors after your
                AI date, newer team members may be generating more code per commit, which
                is worth pairing with the Ramp-Up chart to confirm whether this reflects
                productivity or noise. Use the metric toggle above the chart to explore
                which signals are most visible in your data.
              </p>
              <p className="mt-2">
                To adjust cohort date boundaries, go to{' '}
                <a href="#/settings" className="underline hover:text-foreground">Settings &gt; Cohort Configuration</a>.
              </p>
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
              <p>
                This chart shows how quickly new contributors reached meaningful contribution
                sizes after joining, grouped by the quarter they made their first commit.
                The x-axis is weeks from first commit, and the y-axis is the average number
                of lines changed per commit in that week.
              </p>
              <p className="mt-2">
                Each line represents a cohort of developers who joined in the same quarter.
                Steeper early rises mean contributors ramped up faster — producing
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
              columns will be empty — go to{' '}
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
              This view shows how contribution patterns shifted across your team — not individual performance scores. No default sort is applied to change columns;
              the default sort is total commits, which reflects overall activity level.
            </p>
            <p className="mt-2">
              To adjust cohort boundaries, go to{' '}
              <a href="#/settings" className="underline hover:text-foreground">Settings &gt; Cohort Configuration</a>.
            </p>
          </HelpPanel>
        </section>
      </div>
    </>
  );
}
