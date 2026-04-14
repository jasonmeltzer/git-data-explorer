import { describe, it, expect } from 'vitest';
import { rollingNarrative, cohortTrendNarrative } from '../../lib/narratives.js';
import type { RollingComparisonResult, CohortMetricsRow } from '@shared/types.js';

const makeRollingResult = (changes: Partial<RollingComparisonResult['changes']>): RollingComparisonResult => ({
  granularity: 'month',
  current: {
    label: 'Mar 2026',
    startDate: '2026-03-01T00:00:00.000Z',
    endDate: '2026-03-31T00:00:00.000Z',
    avgCommitSize: 100,
    avgPrSize: 200,
    commitCount: 50,
    prCount: 20,
    avgFilesPerCommit: 3,
    avgFilesPerPr: 5,
    dailyAvgCommitSize: 100,
    dailyAvgPrSize: 200,
    dailyCommitCount: 1.6,
    dailyPrCount: 0.6,
  },
  prior: {
    label: 'Feb 2026',
    startDate: '2026-02-01T00:00:00.000Z',
    endDate: '2026-02-28T00:00:00.000Z',
    avgCommitSize: 80,
    avgPrSize: 150,
    commitCount: 40,
    prCount: 15,
    avgFilesPerCommit: 2,
    avgFilesPerPr: 4,
    dailyAvgCommitSize: 80,
    dailyAvgPrSize: 150,
    dailyCommitCount: 1.4,
    dailyPrCount: 0.5,
  },
  changes: {
    commitSize: null,
    prSize: null,
    commitFrequency: null,
    prFrequency: null,
    ...changes,
  },
});

const makeRow = (
  cohort: CohortMetricsRow['cohort'],
  periodMonth: string,
  totalCount: number,
): CohortMetricsRow => ({
  cohort,
  period: 'all',
  periodMonth,
  avgLinesAdded: 0,
  avgLinesDeleted: 0,
  avgFilesChanged: 0,
  totalCount,
  contributorCount: 1,
});

describe('rollingNarrative', () => {
  it('returns "up" text when prFrequency is positive', () => {
    const result = makeRollingResult({ prFrequency: 25 });
    const narrative = rollingNarrative(result, 'prFrequency');
    expect(narrative).toContain('up');
    expect(narrative).toContain('25%');
    expect(narrative).toContain('month-over-month');
  });

  it('returns "down" text when commitFrequency is negative', () => {
    const result = makeRollingResult({ commitFrequency: -15 });
    const narrative = rollingNarrative(result, 'commitFrequency');
    expect(narrative).toContain('down');
    expect(narrative).toContain('15%');
  });

  it('returns "no prior period data" when changes value is null', () => {
    const result = makeRollingResult({ prFrequency: null });
    const narrative = rollingNarrative(result, 'prFrequency');
    expect(narrative.toLowerCase()).toContain('no prior period data');
  });
});

describe('cohortTrendNarrative', () => {
  it('returns "up" direction string when totalCount increases over time', () => {
    const rows: CohortMetricsRow[] = [
      makeRow('new', '2025-01', 10),
      makeRow('new', '2025-06', 20),
    ];
    const narrative = cohortTrendNarrative(rows, 'totalCount', 'New contributor volume');
    expect(narrative).toContain('up');
  });

  it('returns "down" direction string when totalCount decreases over time', () => {
    const rows: CohortMetricsRow[] = [
      makeRow('new', '2025-01', 100),
      makeRow('new', '2025-06', 50),
    ];
    const narrative = cohortTrendNarrative(rows, 'totalCount', 'New contributor volume');
    expect(narrative).toContain('down');
  });

  it('returns no data message for empty rows', () => {
    const narrative = cohortTrendNarrative([], 'totalCount', 'Test');
    expect(narrative).toContain('No data');
  });
});
