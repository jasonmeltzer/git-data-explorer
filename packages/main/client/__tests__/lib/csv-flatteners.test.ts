import { describe, it, expect } from 'vitest';
import { rollingToCsv, periodMetricsToCsv, concentrationMonthlyToCsv, headcountMonthlyToCsv, executiveSummaryToCsv } from '../../lib/csv-flatteners.js';
import type { RollingComparisonResult } from '@shared/types.js';
import type { ExecutiveSummary, PeriodMetric, ConcentrationMonthlyRow, HeadcountMonthlyRow } from '@shared/export-types.js';

// ─── Test data fixtures ────────────────────────────────────────────────────────

const minimalRolling: RollingComparisonResult = {
  granularity: 'month',
  current: {
    label: 'Mar 2026',
    startDate: '2026-03-01T00:00:00.000Z',
    endDate: '2026-03-31T23:59:59.999Z',
    avgCommitSize: 120,
    avgPrSize: 350,
    commitCount: 45,
    prCount: 12,
    avgFilesPerCommit: 3.2,
    avgFilesPerPr: 7.5,
    dailyAvgCommitSize: 4.0,
    dailyAvgPrSize: 11.3,
    dailyCommitCount: 1.5,
    dailyPrCount: 0.4,
  },
  prior: {
    label: 'Feb 2026',
    startDate: '2026-02-01T00:00:00.000Z',
    endDate: '2026-02-28T23:59:59.999Z',
    avgCommitSize: 100,
    avgPrSize: 300,
    commitCount: 40,
    prCount: 10,
    avgFilesPerCommit: 3.0,
    avgFilesPerPr: 7.0,
    dailyAvgCommitSize: 3.6,
    dailyAvgPrSize: 10.7,
    dailyCommitCount: 1.4,
    dailyPrCount: 0.36,
  },
  changes: {
    commitSize: 20,
    prSize: 16.7,
    commitFrequency: 12.5,
    prFrequency: 20,
  },
};

const minimalPeriodMetrics: PeriodMetric[] = [
  {
    period: {
      startDate: '2025-04-01',
      endDate: '2025-10-01',
      label: 'Before AI',
    },
    metrics: {
      avgCommitSize: 80,
      prFrequency: 5.2,
      rampUpSpeed: null,
      activeContributors: 8,
    },
  },
  {
    period: {
      startDate: '2025-10-01',
      endDate: '2026-04-01',
      label: 'After AI',
      markerDate: '2025-10-01',
    },
    metrics: {
      avgCommitSize: 145,
      prFrequency: 9.8,
      rampUpSpeed: 3.5,
      activeContributors: 12,
    },
  },
];

const minimalConcentration: ConcentrationMonthlyRow[] = [
  {
    month: '2026-01',
    basis: 'commits',
    top1Share: 45.2,
    top3Share: 72.1,
    top5Share: 88.3,
    hhi: 0.23,
    gini: 0.61,
    busFactor: 2,
    activeDevs: 10,
    topContributor: 'alice',
  },
  {
    month: '2026-02',
    basis: 'commits',
    top1Share: 38.0,
    top3Share: 65.5,
    top5Share: 80.0,
    hhi: 0.18,
    gini: 0.55,
    busFactor: 3,
    activeDevs: 12,
    topContributor: 'bob',
  },
];

const minimalHeadcount: HeadcountMonthlyRow[] = [
  {
    month: '2026-01',
    activeDevs: 10,
    totalPrs: 35,
    totalCommits: 120,
    prsPerDev: 3.5,
    commitsPerDev: 12.0,
  },
  {
    month: '2026-02',
    activeDevs: 12,
    totalPrs: 48,
    totalCommits: 150,
    prsPerDev: 4.0,
    commitsPerDev: 12.5,
  },
];

const minimalExecutiveSummary: ExecutiveSummary = {
  totalCommits: 450,
  activeContributors: 15,
  rampUpTrend: 'accelerating',
  aiAdoptionDelta: '+45%',
};

// ─── rollingToCsv ─────────────────────────────────────────────────────────────

describe('rollingToCsv', () => {
  it('produces exactly 3 data rows plus a header row', () => {
    const csv = rollingToCsv(minimalRolling);
    const lines = csv.split('\n');
    // 1 header + 3 data rows = 4 lines
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^current,/);
    expect(lines[2]).toMatch(/^prior,/);
    expect(lines[3]).toMatch(/^changes,/);
  });

  it('includes all expected column headers', () => {
    const csv = rollingToCsv(minimalRolling);
    const header = csv.split('\n')[0];
    expect(header).toContain('period');
    expect(header).toContain('label');
    expect(header).toContain('startDate');
    expect(header).toContain('endDate');
    expect(header).toContain('avgCommitSize');
    expect(header).toContain('avgPrSize');
    expect(header).toContain('commitCount');
    expect(header).toContain('prCount');
    expect(header).toContain('avgFilesPerCommit');
    expect(header).toContain('avgFilesPerPr');
    expect(header).toContain('dailyAvgCommitSize');
    expect(header).toContain('dailyAvgPrSize');
    expect(header).toContain('dailyCommitCount');
    expect(header).toContain('dailyPrCount');
  });

  it('includes current period metric values', () => {
    const csv = rollingToCsv(minimalRolling);
    const lines = csv.split('\n');
    const currentLine = lines[1];
    expect(currentLine).toContain('Mar 2026');
    expect(currentLine).toContain('120');
    expect(currentLine).toContain('45');
  });

  it('includes prior period metric values', () => {
    const csv = rollingToCsv(minimalRolling);
    const lines = csv.split('\n');
    const priorLine = lines[2];
    expect(priorLine).toContain('Feb 2026');
    expect(priorLine).toContain('100');
    expect(priorLine).toContain('40');
  });

  it('includes change values in the changes row', () => {
    const csv = rollingToCsv(minimalRolling);
    const lines = csv.split('\n');
    const changesLine = lines[3];
    expect(changesLine).toContain('20');
    expect(changesLine).toContain('16.7');
    expect(changesLine).toContain('12.5');
  });

  it('serializes null change values as empty strings', () => {
    const rollingWithNulls: RollingComparisonResult = {
      ...minimalRolling,
      changes: {
        commitSize: null,
        prSize: null,
        commitFrequency: null,
        prFrequency: null,
      },
    };
    const csv = rollingToCsv(rollingWithNulls);
    const changesLine = csv.split('\n')[3];
    // The line should start with "changes," and have empty fields (no "null" text)
    expect(changesLine).not.toContain('null');
    expect(changesLine).toMatch(/^changes,/);
  });
});

// ─── periodMetricsToCsv ───────────────────────────────────────────────────────

describe('periodMetricsToCsv', () => {
  it('produces exactly 2 data rows plus a header row for 2 periods', () => {
    const csv = periodMetricsToCsv(minimalPeriodMetrics);
    const lines = csv.split('\n');
    // 1 header + 2 data rows = 3 lines
    expect(lines).toHaveLength(3);
  });

  it('includes all expected column headers', () => {
    const csv = periodMetricsToCsv(minimalPeriodMetrics);
    const header = csv.split('\n')[0];
    expect(header).toContain('label');
    expect(header).toContain('startDate');
    expect(header).toContain('endDate');
    expect(header).toContain('markerDate');
    expect(header).toContain('avgCommitSize');
    expect(header).toContain('prFrequency');
    expect(header).toContain('rampUpSpeed');
    expect(header).toContain('activeContributors');
  });

  it('includes period labels in data rows', () => {
    const csv = periodMetricsToCsv(minimalPeriodMetrics);
    expect(csv).toContain('Before AI');
    expect(csv).toContain('After AI');
  });

  it('includes metric values in data rows', () => {
    const csv = periodMetricsToCsv(minimalPeriodMetrics);
    expect(csv).toContain('80');
    expect(csv).toContain('5.2');
    expect(csv).toContain('145');
    expect(csv).toContain('9.8');
    expect(csv).toContain('3.5');
  });

  it('serializes null metric values as empty strings', () => {
    const csv = periodMetricsToCsv(minimalPeriodMetrics);
    // before period rampUpSpeed is null — should appear as empty, not "null"
    expect(csv).not.toContain('null');
  });

  it('returns empty string for empty input', () => {
    expect(periodMetricsToCsv([])).toBe('');
  });
});

// ─── concentrationMonthlyToCsv ────────────────────────────────────────────────

describe('concentrationMonthlyToCsv', () => {
  it('produces exactly 2 data rows plus a header row', () => {
    const csv = concentrationMonthlyToCsv(minimalConcentration);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
  });

  it('includes all expected column headers', () => {
    const csv = concentrationMonthlyToCsv(minimalConcentration);
    const header = csv.split('\n')[0];
    expect(header).toContain('month');
    expect(header).toContain('basis');
    expect(header).toContain('top1Share');
    expect(header).toContain('top3Share');
    expect(header).toContain('top5Share');
    expect(header).toContain('hhi');
    expect(header).toContain('gini');
    expect(header).toContain('busFactor');
    expect(header).toContain('activeDevs');
    expect(header).toContain('topContributor');
  });

  it('includes month and metric values', () => {
    const csv = concentrationMonthlyToCsv(minimalConcentration);
    expect(csv).toContain('2026-01');
    expect(csv).toContain('45.2');
    expect(csv).toContain('alice');
    expect(csv).toContain('2026-02');
    expect(csv).toContain('38');
    expect(csv).toContain('bob');
  });

  it('returns empty string for empty input', () => {
    expect(concentrationMonthlyToCsv([])).toBe('');
  });
});

// ─── headcountMonthlyToCsv ────────────────────────────────────────────────────

describe('headcountMonthlyToCsv', () => {
  it('produces exactly 2 data rows plus a header row', () => {
    const csv = headcountMonthlyToCsv(minimalHeadcount);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
  });

  it('includes all expected column headers', () => {
    const csv = headcountMonthlyToCsv(minimalHeadcount);
    const header = csv.split('\n')[0];
    expect(header).toContain('month');
    expect(header).toContain('activeDevs');
    expect(header).toContain('totalPrs');
    expect(header).toContain('totalCommits');
    expect(header).toContain('prsPerDev');
    expect(header).toContain('commitsPerDev');
  });

  it('includes month and metric values', () => {
    const csv = headcountMonthlyToCsv(minimalHeadcount);
    expect(csv).toContain('2026-01');
    expect(csv).toContain('10');
    expect(csv).toContain('35');
    expect(csv).toContain('120');
    expect(csv).toContain('2026-02');
    expect(csv).toContain('12');
  });

  it('returns empty string for empty input', () => {
    expect(headcountMonthlyToCsv([])).toBe('');
  });
});

// ─── executiveSummaryToCsv ────────────────────────────────────────────────────

describe('executiveSummaryToCsv', () => {
  it('produces exactly 1 data row plus a header row', () => {
    const csv = executiveSummaryToCsv(minimalExecutiveSummary);
    const lines = csv.split('\n');
    // 1 header + 1 data row = 2 lines
    expect(lines).toHaveLength(2);
  });

  it('includes all expected column headers', () => {
    const csv = executiveSummaryToCsv(minimalExecutiveSummary);
    const header = csv.split('\n')[0];
    expect(header).toContain('totalCommits');
    expect(header).toContain('activeContributors');
    expect(header).toContain('rampUpTrend');
    expect(header).toContain('aiAdoptionDelta');
  });

  it('includes summary values in the data row', () => {
    const csv = executiveSummaryToCsv(minimalExecutiveSummary);
    const dataLine = csv.split('\n')[1];
    expect(dataLine).toContain('450');
    expect(dataLine).toContain('15');
    expect(dataLine).toContain('accelerating');
    expect(dataLine).toContain('+45%');
  });

  it('serializes null values as empty strings', () => {
    const summaryWithNulls: ExecutiveSummary = {
      totalCommits: 100,
      activeContributors: 5,
      rampUpTrend: null,
      aiAdoptionDelta: null,
    };
    const csv = executiveSummaryToCsv(summaryWithNulls);
    expect(csv).not.toContain('null');
    const dataLine = csv.split('\n')[1];
    // fields: totalCommits, activeContributors, rampUpTrend, aiAdoptionDelta
    const fields = dataLine.split(',');
    expect(fields[2]).toBe('');  // rampUpTrend
    expect(fields[3]).toBe('');  // aiAdoptionDelta
  });
});
