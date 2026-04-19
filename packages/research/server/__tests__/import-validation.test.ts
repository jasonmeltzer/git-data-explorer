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

// ─── Phase 9.4 row-schema rejection tests ──────────────────────────────────
// Each of the 3 new row schemas (ConcentrationMonthlyRowSchema,
// HeadcountMonthlyRowSchema, PeriodMetricSchema) is exercised via the
// ExportBundle envelope — valid-shape positive cases, then rejection cases
// for bad enum values, wrong types, and missing required fields.

describe('Phase 9.4 row schemas — rejection cases', () => {
  describe('ConcentrationMonthlyRowSchema', () => {
    const validRow = {
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
    };

    it('accepts a valid row', () => {
      const result = validateBundle({ ...validBundle, concentrationMonthly: [validRow] });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid basis value', () => {
      const bad = { ...validRow, basis: 'foo' };
      const result = validateBundle({ ...validBundle, concentrationMonthly: [bad] });
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => /basis/.test(e))).toBe(true);
    });

    it('rejects missing month', () => {
      const { month, ...bad } = validRow;
      void month;
      const result = validateBundle({ ...validBundle, concentrationMonthly: [bad as unknown] });
      expect(result.valid).toBe(false);
    });

    it('rejects top1Share as string (wrong type)', () => {
      const bad = { ...validRow, top1Share: '40' as unknown };
      const result = validateBundle({ ...validBundle, concentrationMonthly: [bad] });
      expect(result.valid).toBe(false);
    });

    it('accepts all nullable numeric fields as null', () => {
      const nullRow = {
        month: '2025-06',
        basis: 'commits',
        top1Share: null,
        top3Share: null,
        top5Share: null,
        hhi: null,
        gini: null,
        busFactor: null,
        activeDevs: 0,
        topContributor: null,
      };
      const result = validateBundle({ ...validBundle, concentrationMonthly: [nullRow] });
      expect(result.valid).toBe(true);
    });
  });

  describe('HeadcountMonthlyRowSchema', () => {
    const validRow = {
      month: '2025-06',
      activeDevs: 10,
      totalPrs: 30,
      totalCommits: 150,
      prsPerDev: 3,
      commitsPerDev: 15,
    };

    it('accepts a valid row', () => {
      const result = validateBundle({ ...validBundle, headcountMonthly: [validRow] });
      expect(result.valid).toBe(true);
    });

    it('rejects activeDevs as string', () => {
      const bad = { ...validRow, activeDevs: '10' as unknown };
      const result = validateBundle({ ...validBundle, headcountMonthly: [bad] });
      expect(result.valid).toBe(false);
    });

    it('rejects missing totalPrs', () => {
      const { totalPrs, ...bad } = validRow;
      void totalPrs;
      const result = validateBundle({ ...validBundle, headcountMonthly: [bad as unknown] });
      expect(result.valid).toBe(false);
    });

    it('accepts null prsPerDev and commitsPerDev (zero-activity edge case)', () => {
      const zeroRow = {
        month: '2025-06',
        activeDevs: 0,
        totalPrs: 0,
        totalCommits: 0,
        prsPerDev: null,
        commitsPerDev: null,
      };
      const result = validateBundle({ ...validBundle, headcountMonthly: [zeroRow] });
      expect(result.valid).toBe(true);
    });
  });

  describe('PeriodMetricSchema', () => {
    const validPeriod = {
      period: { startDate: '2025-01-01', endDate: '2025-06-30', label: 'Pre-AI' },
      metrics: { avgCommitSize: 150, prFrequency: 3, rampUpSpeed: 8, activeContributors: 10 },
    };

    it('accepts a valid period metric', () => {
      const result = validateBundle({ ...validBundle, periodMetrics: [validPeriod] });
      expect(result.valid).toBe(true);
    });

    it('accepts period with optional markerDate', () => {
      const withMarker = {
        ...validPeriod,
        period: { ...validPeriod.period, markerDate: '2025-07-01' },
      };
      const result = validateBundle({ ...validBundle, periodMetrics: [withMarker] });
      expect(result.valid).toBe(true);
    });

    it('rejects missing period.label', () => {
      const bad = {
        period: { startDate: '2025-01-01', endDate: '2025-06-30' } as unknown,
        metrics: validPeriod.metrics,
      };
      const result = validateBundle({ ...validBundle, periodMetrics: [bad] });
      expect(result.valid).toBe(false);
    });

    it('rejects non-string startDate (number)', () => {
      const bad = {
        period: { startDate: 1735689600 as unknown, endDate: '2025-06-30', label: 'Pre-AI' },
        metrics: validPeriod.metrics,
      };
      const result = validateBundle({ ...validBundle, periodMetrics: [bad] });
      expect(result.valid).toBe(false);
    });

    it('rejects metrics values that are not number|null (string)', () => {
      const bad = {
        ...validPeriod,
        metrics: { avgCommitSize: 'large' as unknown },
      };
      const result = validateBundle({ ...validBundle, periodMetrics: [bad] });
      expect(result.valid).toBe(false);
    });

    it('accepts metrics with null values (nullable contract)', () => {
      const withNulls = {
        ...validPeriod,
        metrics: { avgCommitSize: null, prFrequency: null, rampUpSpeed: 8, activeContributors: 10 },
      };
      const result = validateBundle({ ...validBundle, periodMetrics: [withNulls] });
      expect(result.valid).toBe(true);
    });
  });
});
