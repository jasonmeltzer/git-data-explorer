import type { CohortMetricsRow } from '@shared/types.js';
import { COHORT_KEYS, cohortSqlLabelToKey } from '@shared/cohort-config.js';

export interface ChartPoint {
  month: number;  // epoch ms
  [key: string]: number;  // dynamic cohort keys: 'new', 'mid', 'senior'
}

export function cohortRowsToChartData(
  rows: CohortMetricsRow[],
  metric: 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged' | 'totalCount'
): ChartPoint[] {
  const byMonth = new Map<string, ChartPoint>();
  for (const row of rows) {
    if (!byMonth.has(row.periodMonth)) {
      // Initialize all cohort keys to 0
      const point: ChartPoint = { month: new Date(row.periodMonth + '-01T00:00:00Z').getTime() };
      for (const key of COHORT_KEYS) {
        point[key] = 0;
      }
      byMonth.set(row.periodMonth, point);
    }
    const point = byMonth.get(row.periodMonth)!;
    const key = cohortSqlLabelToKey[row.cohort];
    if (key) {
      point[key] = row[metric];
    }
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month - b.month);
}
