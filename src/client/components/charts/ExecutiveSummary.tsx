import { useExecutiveSummary } from '../../hooks/useExecutiveSummary.js';
import { computeExecutiveSummaryInsights } from '../../lib/insights.js';
import { SectionHeader } from '../SectionHeader.js';
import { FilterScopeBadge } from '../FilterScopeBadge.js';
import { StatCalloutBox } from './StatCalloutBox.js';

interface ExecutiveSummaryProps {
  startDate: string;
  endDate: string;
  repoIds: number[];
}

export function ExecutiveSummary({ startDate, endDate, repoIds }: ExecutiveSummaryProps) {
  const { data, isFetching } = useExecutiveSummary({ startDate, endDate, repoIds });

  const fallback = {
    totalCommits: 0,
    activeContributors: 0,
    rampUpTrend: null,
    aiAdoptionDelta: null,
  };

  const insights = data
    ? computeExecutiveSummaryInsights(data)
    : computeExecutiveSummaryInsights(fallback);

  const filteredInsights = insights.filter(i => i.label === 'Total Commits' || i.label === 'Active Contributors');
  const aiInsights = insights.filter(i => i.label === 'Ramp-Up Trend' || i.label === 'AI Adoption Delta');

  const headlineTakeaway = data
    ? `${data.totalCommits.toLocaleString()} commits from ${data.activeContributors} contributors in the selected period.`
    : '';

  return (
    <section>
      <SectionHeader title="Executive Summary" scope="filtered" />

      {/* Row 1: Filtered metrics (respect date range & repo filters) */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        {filteredInsights.map((insight) => (
          <StatCalloutBox
            key={insight.label}
            label={insight.label}
            value={insight.value}
            delta={insight.delta}
            deltaDir={insight.deltaDir}
            isLoading={isFetching && !data}
          />
        ))}
      </div>

      {headlineTakeaway && (
        <p className="mt-3 text-sm text-muted-foreground">{headlineTakeaway}</p>
      )}

      {/* Row 2: AI comparison metrics (span all available data) */}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">AI Impact</span>
        <FilterScopeBadge scope="independent" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-4">
        {aiInsights.map((insight) => (
          <StatCalloutBox
            key={insight.label}
            label={insight.label}
            value={insight.value}
            delta={insight.delta}
            deltaDir={insight.deltaDir}
            isLoading={isFetching && !data}
          />
        ))}
      </div>
    </section>
  );
}
