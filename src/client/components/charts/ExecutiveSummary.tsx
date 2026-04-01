import { useExecutiveSummary } from '../../hooks/useExecutiveSummary.js';
import { computeExecutiveSummaryInsights } from '../../lib/insights.js';
import { SectionHeader } from '../SectionHeader.js';
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

  const headlineTakeaway = data
    ? `${data.totalCommits.toLocaleString()} commits from ${data.activeContributors} contributors in the selected period.`
    : '';

  return (
    <section>
      <SectionHeader title="Executive Summary" scope="filtered" />
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        {insights.map((insight) => (
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
    </section>
  );
}
