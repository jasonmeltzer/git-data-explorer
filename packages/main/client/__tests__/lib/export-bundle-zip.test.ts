import { describe, test, expect } from 'vitest';
import { strFromU8 } from 'fflate';
import { buildZipFileEntries } from '../../components/ExportModal.js';
import type { ExportBundle } from '@shared/export-types.js';

function minimalBundle(): ExportBundle {
  return {
    metadata: {
      exportTimestamp: '2026-04-01T00:00:00Z',
      startDate: '2025-04-01T00:00:00Z',
      endDate: '2026-04-01T00:00:00Z',
      aiMarkerDate: '2025-10-01',
      tenureMode: 'global',
      repoIds: [1],
      repoNames: ['org/repo'],
      cohortConfig: { thresholds: [] } as unknown as never,
      toolVersion: '1.0.0',
      rollingGranularity: 'month',
      orgName: null,
    },
    cohortCommits: [], cohortPrs: [], rampUp: [],
    rolling: null, contributors: [], prTurnaround: [], botRatio: [],
    executiveSummary: null,
    periodMetrics: null,
    concentrationMonthly: [],
    headcountMonthly: [],
    developerMonthly: [],   // Phase 9.5-01 — type-skeleton stub
  };
}

function parseJson<T>(bytes: Uint8Array): T {
  return JSON.parse(strFromU8(bytes));
}

describe('buildZipFileEntries — JSON format', () => {
  test('always includes metadata.json', () => {
    const files = buildZipFileEntries(minimalBundle(), 'json');
    expect(files['metadata.json']).toBeDefined();
  });

  test('includes all 7 baseline JSON sections even when empty', () => {
    const files = buildZipFileEntries(minimalBundle(), 'json');
    const expected = [
      'cohort-commits.json',
      'cohort-prs.json',
      'ramp-up.json',
      'rolling-comparison.json',
      'contributors.json',
      'pr-turnaround.json',
      'bot-ratio.json',
    ];
    for (const name of expected) {
      expect(files[name]).toBeDefined();
    }
  });

  test('OMITS executive-summary.json when executiveSummary is null', () => {
    const files = buildZipFileEntries(minimalBundle(), 'json');
    expect(files['executive-summary.json']).toBeUndefined();
  });

  test('OMITS period-metrics.json when periodMetrics is null', () => {
    const files = buildZipFileEntries(minimalBundle(), 'json');
    expect(files['period-metrics.json']).toBeUndefined();
  });

  test('OMITS period-metrics.json when periodMetrics is empty array (FIX from 9.4.1-06)', () => {
    const b = minimalBundle();
    b.periodMetrics = [];
    const files = buildZipFileEntries(b, 'json');
    expect(files['period-metrics.json']).toBeUndefined();
  });

  test('INCLUDES period-metrics.json when periodMetrics has entries', () => {
    const b = minimalBundle();
    b.periodMetrics = [
      {
        period: { startDate: '2025-01-01', endDate: '2025-06-30', label: 'Pre-AI' },
        metrics: { avgCommitSize: 150 },
      },
    ];
    const files = buildZipFileEntries(b, 'json');
    expect(files['period-metrics.json']).toBeDefined();
    const parsed = parseJson<unknown[]>(files['period-metrics.json']);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
  });

  test('OMITS concentration-monthly.json when concentrationMonthly is empty', () => {
    const files = buildZipFileEntries(minimalBundle(), 'json');
    expect(files['concentration-monthly.json']).toBeUndefined();
  });

  test('INCLUDES concentration-monthly.json when concentrationMonthly has entries', () => {
    const b = minimalBundle();
    b.concentrationMonthly = [
      {
        month: '2025-06',
        basis: 'prs',
        top1Share: 40,
        top3Share: 60,
        top5Share: 75,
        hhi: 0.15,
        gini: 0.3,
        busFactor: 3,
        activeDevs: 8,
        topContributor: 'alice',
      },
    ];
    const files = buildZipFileEntries(b, 'json');
    expect(files['concentration-monthly.json']).toBeDefined();
  });

  test('OMITS headcount-monthly.json when headcountMonthly is empty', () => {
    const files = buildZipFileEntries(minimalBundle(), 'json');
    expect(files['headcount-monthly.json']).toBeUndefined();
  });

  test('INCLUDES headcount-monthly.json when headcountMonthly has entries', () => {
    const b = minimalBundle();
    b.headcountMonthly = [
      {
        month: '2025-06',
        activeDevs: 5,
        totalPrs: 20,
        totalCommits: 100,
        prsPerDev: 4,
        commitsPerDev: 20,
      },
    ];
    const files = buildZipFileEntries(b, 'json');
    expect(files['headcount-monthly.json']).toBeDefined();
  });

  test('OMITS developer-monthly.json when developerMonthly is empty', () => {
    const files = buildZipFileEntries(minimalBundle(), 'json');
    expect(files['developer-monthly.json']).toBeUndefined();
  });

  test('INCLUDES developer-monthly.json when developerMonthly has entries', () => {
    const b = minimalBundle();
    b.developerMonthly = [
      {
        authorLogin: 'alice',
        month: '2025-06',
        prCount: 3,
        commitCount: 10,
        meanLinesPerCommit: 50,
        medianLinesPerCommit: 40,
        meanFilesPerCommit: 2,
        medianFilesPerCommit: 1,
      },
    ];
    const files = buildZipFileEntries(b, 'json');
    expect(files['developer-monthly.json']).toBeDefined();
  });
});

describe('buildZipFileEntries — CSV format', () => {
  test('includes metadata.json (always JSON regardless of format)', () => {
    const files = buildZipFileEntries(minimalBundle(), 'csv');
    expect(files['metadata.json']).toBeDefined();
  });

  test('OMITS period-metrics.csv when empty', () => {
    const b = minimalBundle();
    b.periodMetrics = [];
    const files = buildZipFileEntries(b, 'csv');
    expect(files['period-metrics.csv']).toBeUndefined();
  });

  test('OMITS rolling-comparison.csv when rolling is null', () => {
    const files = buildZipFileEntries(minimalBundle(), 'csv');
    expect(files['rolling-comparison.csv']).toBeUndefined();
  });

  test('OMITS developer-monthly.csv when developerMonthly is empty', () => {
    const files = buildZipFileEntries(minimalBundle(), 'csv');
    expect(files['developer-monthly.csv']).toBeUndefined();
  });

  test('INCLUDES all 4 Phase 9.4+9.5 CSVs when data present (CSV/JSON parity)', () => {
    const b = minimalBundle();
    b.periodMetrics = [
      {
        period: { startDate: '2025-01-01', endDate: '2025-06-30', label: 'Pre-AI' },
        metrics: { avgCommitSize: 150 },
      },
    ];
    b.concentrationMonthly = [
      {
        month: '2025-06',
        basis: 'prs',
        top1Share: 40,
        top3Share: 60,
        top5Share: 75,
        hhi: 0.15,
        gini: 0.3,
        busFactor: 3,
        activeDevs: 8,
        topContributor: 'alice',
      },
    ];
    b.headcountMonthly = [
      {
        month: '2025-06',
        activeDevs: 5,
        totalPrs: 20,
        totalCommits: 100,
        prsPerDev: 4,
        commitsPerDev: 20,
      },
    ];
    b.developerMonthly = [
      {
        authorLogin: 'alice',
        month: '2025-06',
        prCount: 3,
        commitCount: 10,
        meanLinesPerCommit: 50,
        medianLinesPerCommit: 40,
        meanFilesPerCommit: 2,
        medianFilesPerCommit: 1,
      },
    ];
    const files = buildZipFileEntries(b, 'csv');
    expect(files['period-metrics.csv']).toBeDefined();
    expect(files['concentration-monthly.csv']).toBeDefined();
    expect(files['headcount-monthly.csv']).toBeDefined();
    expect(files['developer-monthly.csv']).toBeDefined();
    // Sanity: CSV body has the header row plus one data row
    const csv = strFromU8(files['developer-monthly.csv']);
    expect(csv).toContain('authorLogin,month,prCount');
    expect(csv).toContain('alice,2025-06');
  });
});
