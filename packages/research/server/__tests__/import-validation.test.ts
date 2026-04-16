import { describe, it, expect } from 'vitest';
import { validateBundle, ExportBundleSchema } from '../services/validation.js';

const validMetadata = {
  exportTimestamp: '2024-01-15T10:00:00Z',
  startDate: '2023-01-01T00:00:00Z',
  endDate: '2024-01-01T00:00:00Z',
  aiMarkerDate: '2023-06-01T00:00:00Z',
  tenureMode: 'global' as const,
  repoIds: [1, 2],
  repoNames: ['org/repo-a', 'org/repo-b'],
  cohortConfig: {
    thresholds: [
      { maxMonths: 3, key: 'new', label: 'New (0-3mo)', color: 'var(--chart-cohort-new)' },
      { maxMonths: 12, key: 'mid', label: 'Growing (3-12mo)', color: 'var(--chart-cohort-mid)' },
      { maxMonths: null, key: 'senior', label: 'Senior (1yr+)', color: 'var(--chart-cohort-senior)' },
    ] as [{ maxMonths: number | null; key: string; label: string; color: string }, { maxMonths: number | null; key: string; label: string; color: string }, { maxMonths: number | null; key: string; label: string; color: string }],
  },
  toolVersion: '1.0.0',
  rollingGranularity: 'month' as const,
};

const validBundle = {
  metadata: validMetadata,
  cohortCommits: [
    {
      cohort: 'new',
      period: 'before' as const,
      periodMonth: '2023-01',
      avgLinesAdded: 100,
      avgLinesDeleted: 20,
      avgFilesChanged: 3,
      totalCount: 50,
      contributorCount: 5,
    },
  ],
  cohortPrs: [],
  rampUp: [],
  rolling: null,
  contributors: [],
  prTurnaround: [],
  botRatio: [],
  executiveSummary: null,
  periodMetrics: null,
  concentrationMonthly: [],
  headcountMonthly: [],
};

describe('validateBundle', () => {
  it('valid ExportBundle passes validation and returns data', () => {
    const result = validateBundle(validBundle);
    expect(result.valid).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.metadata.toolVersion).toBe('1.0.0');
  });

  it('bundle with missing metadata field fails with specific error path', () => {
    const { exportTimestamp: _removed, ...partialMeta } = validMetadata;
    const bundle = { ...validBundle, metadata: partialMeta };
    const result = validateBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    // Zod error should reference the missing field
    const hasExportTimestampError = result.errors!.some((e) =>
      e.includes('exportTimestamp')
    );
    expect(hasExportTimestampError).toBe(true);
  });

  it('bundle with null rolling/executiveSummary/periodMetrics passes (nullable sections)', () => {
    const bundle = {
      ...validBundle,
      rolling: null,
      executiveSummary: null,
      periodMetrics: null,
    };
    const result = validateBundle(bundle);
    expect(result.valid).toBe(true);
    expect(result.data?.rolling).toBeNull();
    expect(result.data?.executiveSummary).toBeNull();
    expect(result.data?.periodMetrics).toBeNull();
  });

  it('bundle with empty cohortCommits array passes with warning', () => {
    const bundle = { ...validBundle, cohortCommits: [] };
    const result = validateBundle(bundle);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('cohortCommits is empty');
  });

  it('completely empty object fails validation', () => {
    const result = validateBundle({});
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('bundle with extra unknown fields passes (Zod strips them by default)', () => {
    const bundle = {
      ...validBundle,
      unknownField: 'should be stripped',
      anotherExtra: 42,
    };
    const result = validateBundle(bundle);
    expect(result.valid).toBe(true);
    // Extra fields should not be in the parsed data
    expect((result.data as Record<string, unknown>).unknownField).toBeUndefined();
  });

  it('warns for null rolling section', () => {
    const result = validateBundle({ ...validBundle, rolling: null });
    expect(result.warnings).toContain('rolling section is null');
  });

  it('warns for null executiveSummary section', () => {
    const result = validateBundle({ ...validBundle, executiveSummary: null });
    expect(result.warnings).toContain('executiveSummary section is null');
  });

  it('warns for null periodMetrics section', () => {
    const result = validateBundle({ ...validBundle, periodMetrics: null });
    expect(result.warnings).toContain('periodMetrics section is null');
  });

  it('ExportBundleSchema is exported and usable directly', () => {
    const parsed = ExportBundleSchema.safeParse(validBundle);
    expect(parsed.success).toBe(true);
  });
});
