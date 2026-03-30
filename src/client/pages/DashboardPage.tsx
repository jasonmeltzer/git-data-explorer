import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDashboardFilters } from '../hooks/useDashboardFilters.js';
import { useAiMarker } from '../hooks/useAiMarker.js';
import { useCohortPrs } from '../hooks/useCohortPrs.js';
import { useCohortCommits } from '../hooks/useCohortCommits.js';
import { useRampUp } from '../hooks/useRampUp.js';
import { useRolling } from '../hooks/useRolling.js';
import { cohortTrendNarrative, rollingNarrative } from '../lib/narratives.js';
import FilterBar from '../components/FilterBar.js';
import CohortAreaChart from '../components/charts/CohortAreaChart.js';
import RampUpLineChart from '../components/charts/RampUpLineChart.js';
import RollingCards from '../components/charts/RollingCards.js';
import NarrativeCard from '../components/charts/NarrativeCard.js';
import { ContributorTable } from '../components/ContributorTable.js';
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

  // Check token + repos existence
  const { data: trackedData, isLoading: reposLoading } = useQuery<{ repos: TrackedRepo[] }>({
    queryKey: ['repos', 'tracked'],
    queryFn: () => fetch('/api/repos').then((r) => r.json()),
  });
  const { data: tokenData } = useQuery<{ configured: boolean }>({
    queryKey: ['settings', 'token'],
    queryFn: () => fetch('/api/settings/token').then((r) => r.json()),
  });

  const trackedRepos = trackedData?.repos ?? [];
  const hasToken = tokenData?.configured ?? true; // assume configured until we know
  const anyFetching = prFetching || commitFetching || rampUpFetching || rollingFetching;
  const anyError = prError || commitError || rampUpError || rollingError;

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
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-12">
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

        {/* PR Size Trends */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">PR Size Trends</h2>
            <Tabs value={prMetric} onValueChange={(v) => setPrMetric(v as MetricOption)}>
              <TabsList className="h-7">
                {METRIC_OPTIONS.map(({ label, value }) => (
                  <TabsTrigger key={value} value={value} className="text-xs px-2 py-0.5">
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <NarrativeCard
            text={cohortTrendNarrative(prData, prMetric, 'PR volume')}
            isFetching={prFetching && prData.length === 0}
          />
          <CohortAreaChart
            data={prData}
            metric={prMetric}
            title="PR Count by Cohort"
            aiMarkerDate={markerDate}
            isFetching={prFetching}
          />
        </section>

        {/* Commit Size Trends */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Commit Size Trends</h2>
            <Tabs value={commitMetric} onValueChange={(v) => setCommitMetric(v as MetricOption)}>
              <TabsList className="h-7">
                {METRIC_OPTIONS.map(({ label, value }) => (
                  <TabsTrigger key={value} value={value} className="text-xs px-2 py-0.5">
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <NarrativeCard
            text={cohortTrendNarrative(commitData, commitMetric, 'Commit volume')}
            isFetching={commitFetching && commitData.length === 0}
          />
          <CohortAreaChart
            data={commitData}
            metric={commitMetric}
            title="Commit Count by Cohort"
            aiMarkerDate={markerDate}
            isFetching={commitFetching}
          />
        </section>

        {/* New Developer Ramp-Up */}
        <section>
          <h2 className="text-xl font-semibold mb-4">New Developer Ramp-Up</h2>
          <RampUpLineChart
            data={rampUpData}
            isFetching={rampUpFetching}
          />
        </section>

        {/* Rolling Period Comparison */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Rolling Period Comparison</h2>
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
        </section>

        {/* Contributor Patterns by Author (per D-15, D-16, D-18) */}
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
