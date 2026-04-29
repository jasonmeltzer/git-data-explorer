import { DeveloperMiniChart, type DeveloperMiniChartDatum } from './DeveloperMiniChart.js';
import type { DeveloperMonthlyRow } from '@shared/types.js';
import type { DeveloperMetricOption } from '@shared/lib/narratives.js';

/**
 * Phase 9.5 (D-01 Layout A): small-multiples grid for ≤8 active devs.
 *
 * Reproduces the LDX3 Bowie/O'Donnell/Elvander 3-up trajectory slide pattern.
 * Sort order: tenure descending (D-06).
 */

export interface DeveloperWithRows {
  authorLogin: string;
  tenureJoinedAt: string | null;  // ISO date or null if unknown
  cohortKey: string;              // 'new' | 'mid' | 'senior'
  rows: DeveloperMonthlyRow[];
}

interface DeveloperTrajectoryGridProps {
  developers: DeveloperWithRows[];
  metric: DeveloperMetricOption;
  aiMarkerMonth: string | null;
  cohortMeanByMonthAndCohort: Map<string, Map<string, number | null>>;  // cohortKey -> month -> mean
  onChartClick: (authorLogin: string) => void;
  isLoading?: boolean;
}

export function DeveloperTrajectoryGrid({
  developers,
  metric,
  aiMarkerMonth,
  cohortMeanByMonthAndCohort,
  onChartClick,
  isLoading = false,
}: DeveloperTrajectoryGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {developers.map(dev => {
        const data: DeveloperMiniChartDatum[] = dev.rows.map(r => ({
          month: r.month,
          value: getMetricValue(r, metric),
          cohortMean: cohortMeanByMonthAndCohort.get(dev.cohortKey)?.get(r.month) ?? null,
        }));
        return (
          <div key={dev.authorLogin} className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground truncate" title={dev.authorLogin}>
              {dev.authorLogin}
            </div>
            <DeveloperMiniChart
              authorLogin={dev.authorLogin}
              data={data}
              metric={metric}
              aiMarkerMonth={aiMarkerMonth}
              isLoading={isLoading}
              compact
              onClick={onChartClick}
            />
          </div>
        );
      })}
    </div>
  );
}

function getMetricValue(row: DeveloperMonthlyRow, metric: DeveloperMetricOption): number | null {
  switch (metric) {
    case 'prCount': return row.prCount;
    case 'commitCount': return row.commitCount;
    case 'linesPerCommit': return row.meanLinesPerCommit;
    case 'filesPerCommit': return row.meanFilesPerCommit;
  }
}

/**
 * Phase 9.5 (D-01): Choose between Layout A (grid) and Layout C (list)
 * based on active-dev count. Threshold = 8 (D-01 strict). Exported for tests
 * and for DashboardPage to compute layout key from the data.
 */
export const DEV_LAYOUT_THRESHOLD = 8;

export function chooseDevLayout(activeDevs: number): 'grid' | 'list' {
  return activeDevs <= DEV_LAYOUT_THRESHOLD ? 'grid' : 'list';
}
