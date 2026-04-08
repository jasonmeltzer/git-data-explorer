import { describe, it, expect } from 'vitest';
import { rollingToCsv, beforeAfterToCsv, executiveSummaryToCsv } from '../../lib/csv-flatteners.js';
import type { RollingComparisonResult } from '@shared/types.js';
import type { BeforeAfterComparison, ExecutiveSummary } from '@shared/export-types.js';

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

const minimalBeforeAfter: BeforeAfterComparison = {
  before: {
    avgCommitSize: 80,
    prFrequency: 5.2,
    rampUpSpeed: null,
    activeContributors: 8,
  },
  after: {
    avgCommitSize: 145,
    prFrequency: 9.8,
    rampUpSpeed: 3.5,
    activeContributors: 12,
  },
  markerDate: '2025-10-01',
};

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

// ─── beforeAfterToCsv ─────────────────────────────────────────────────────────

describe('beforeAfterToCsv', () => {
  it('produces exactly 2 data rows plus a header row', () => {
    const csv = beforeAfterToCsv(minimalBeforeAfter);
    const lines = csv.split('\n');
    // 1 header + 2 data rows = 3 lines
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^before,/);
    expect(lines[2]).toMatch(/^after,/);
  });

  it('includes all expected column headers', () => {
    const csv = beforeAfterToCsv(minimalBeforeAfter);
    const header = csv.split('\n')[0];
    expect(header).toContain('period');
    expect(header).toContain('avgCommitSize');
    expect(header).toContain('prFrequency');
    expect(header).toContain('rampUpSpeed');
    expect(header).toContain('activeContributors');
    expect(header).toContain('markerDate');
  });

  it('includes before and after metric values', () => {
    const csv = beforeAfterToCsv(minimalBeforeAfter);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('80');
    expect(lines[1]).toContain('5.2');
    expect(lines[2]).toContain('145');
    expect(lines[2]).toContain('9.8');
    expect(lines[2]).toContain('3.5');
  });

  it('includes markerDate in both rows', () => {
    const csv = beforeAfterToCsv(minimalBeforeAfter);
    const lines = csv.split('\n');
    expect(lines[1]).toContain('2025-10-01');
    expect(lines[2]).toContain('2025-10-01');
  });

  it('serializes null rampUpSpeed as empty string, not "null"', () => {
    const csv = beforeAfterToCsv(minimalBeforeAfter);
    // before.rampUpSpeed is null — should appear as empty, not "null"
    expect(csv).not.toContain('null');
    const beforeLine = csv.split('\n')[1];
    // The rampUpSpeed field (4th field after "before") should be empty
    const fields = beforeLine.split(',');
    // fields: [period, avgCommitSize, prFrequency, rampUpSpeed, activeContributors, markerDate]
    expect(fields[3]).toBe('');
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
