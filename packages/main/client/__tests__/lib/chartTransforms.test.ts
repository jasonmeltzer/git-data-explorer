import { describe, it, expect } from 'vitest';
import { cohortRowsToChartData } from '@shared/lib/chartTransforms.js';
import type { CohortMetricsRow } from '@shared/types.js';

const makeRow = (
  cohort: CohortMetricsRow['cohort'],
  periodMonth: string,
  totalCount: number,
  avgLinesAdded = 0,
): CohortMetricsRow => ({
  cohort,
  period: 'all',
  periodMonth,
  avgLinesAdded,
  avgLinesDeleted: 0,
  avgFilesChanged: 0,
  totalCount,
  contributorCount: 1,
});

describe('cohortRowsToChartData', () => {
  it('converts 3 cohorts across 2 months into 2 ChartPoints with correct month epoch and values', () => {
    const rows: CohortMetricsRow[] = [
      makeRow('0-3mo', '2025-01', 10),
      makeRow('3-12mo', '2025-01', 20),
      makeRow('1yr+', '2025-01', 30),
      makeRow('0-3mo', '2025-02', 15),
      makeRow('3-12mo', '2025-02', 25),
      makeRow('1yr+', '2025-02', 35),
    ];

    const result = cohortRowsToChartData(rows, 'totalCount');

    expect(result).toHaveLength(2);
    expect(result[0].month).toBe(new Date('2025-01-01T00:00:00Z').getTime());
    expect(result[0].new).toBe(10);
    expect(result[0].mid).toBe(20);
    expect(result[0].senior).toBe(30);
    expect(result[1].month).toBe(new Date('2025-02-01T00:00:00Z').getTime());
    expect(result[1].new).toBe(15);
    expect(result[1].mid).toBe(25);
    expect(result[1].senior).toBe(35);
  });

  it('fills missing cohort for a month with 0', () => {
    const rows: CohortMetricsRow[] = [
      makeRow('0-3mo', '2025-03', 5),
      // 3-12mo is missing for 2025-03
      makeRow('1yr+', '2025-03', 40),
    ];

    const result = cohortRowsToChartData(rows, 'totalCount');

    expect(result).toHaveLength(1);
    expect(result[0].new).toBe(5);
    expect(result[0].mid).toBe(0);
    expect(result[0].senior).toBe(40);
  });

  it('returns empty array for empty input', () => {
    const result = cohortRowsToChartData([], 'totalCount');
    expect(result).toEqual([]);
  });

  it('sorts output by month ascending', () => {
    const rows: CohortMetricsRow[] = [
      makeRow('0-3mo', '2025-06', 10),
      makeRow('0-3mo', '2025-01', 20),
      makeRow('0-3mo', '2025-03', 15),
    ];

    const result = cohortRowsToChartData(rows, 'totalCount');

    expect(result[0].month).toBeLessThan(result[1].month);
    expect(result[1].month).toBeLessThan(result[2].month);
  });
});
