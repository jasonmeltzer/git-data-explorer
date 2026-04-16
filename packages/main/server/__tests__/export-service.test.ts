import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (must be hoisted before any imports) ────────────────────────

vi.mock('../services/analytics-cohorts.js', () => ({
  getCohortCommitMetrics: vi.fn().mockReturnValue([]),
  getCohortPrMetrics: vi.fn().mockReturnValue([]),
}));

vi.mock('../services/analytics-rampup.js', () => ({
  getRampUpCurves: vi.fn().mockReturnValue([]),
}));

vi.mock('../services/analytics-rolling.js', () => ({
  getRollingComparison: vi.fn().mockReturnValue(null),
}));

vi.mock('../services/analytics-contributors.js', () => ({
  getContributorStats: vi.fn().mockReturnValue([]),
  getContributorBeforeAfterStats: vi.fn().mockReturnValue([]),
}));

vi.mock('../services/analytics-pr-turnaround.js', () => ({
  getPrTurnaroundTrend: vi.fn().mockReturnValue([]),
}));

vi.mock('../services/analytics-bot-ratio.js', () => ({
  getBotRatioTrend: vi.fn().mockReturnValue([]),
}));

vi.mock('../services/analytics-summary.js', () => ({
  getExecutiveSummary: vi.fn().mockReturnValue({
    totalCommits: 100,
    activeContributors: 5,
    rampUpTrend: null,
    aiAdoptionDelta: null,
  }),
}));

vi.mock('@shared/lib/periods.js', () => ({
  buildPeriodsFromMarker: vi.fn().mockReturnValue([
    { startDate: '2025-01-01', endDate: '2025-12-31', label: 'All-time' },
  ]),
}));

vi.mock('../services/analytics-concentration.js', () => ({
  getConcentrationMonthly: vi.fn().mockReturnValue([]),
}));

vi.mock('../services/analytics-headcount.js', () => ({
  getHeadcountMonthly: vi.fn().mockReturnValue([]),
}));

vi.mock('../services/analytics-period-metrics.js', () => ({
  getPeriodMetrics: vi.fn().mockReturnValue([]),
}));

vi.mock('../services/analytics-config.js', () => ({
  getAiMarkerDate: vi.fn().mockReturnValue(null),
}));

vi.mock('../services/cohort-config-service.js', () => ({
  getCohortConfig: vi.fn().mockReturnValue({
    thresholds: [
      { maxMonths: 3, key: 'new', label: 'New (0-3mo)', color: 'var(--chart-cohort-new)' },
      { maxMonths: 12, key: 'mid', label: 'Growing (3-12mo)', color: 'var(--chart-cohort-mid)' },
      { maxMonths: null, key: 'senior', label: 'Senior (1yr+)', color: 'var(--chart-cohort-senior)' },
    ],
  }),
}));

vi.mock('../services/repo-management.js', () => ({
  getTrackedRepos: vi.fn().mockReturnValue([
    { id: 1, fullName: 'org/repo-one', name: 'repo-one', ownerLogin: 'org', isPrivate: false, defaultBranch: 'main', addedAt: '2025-01-01', removedAt: null, githubId: 101, repoCreatedAt: null },
    { id: 2, fullName: 'org/repo-two', name: 'repo-two', ownerLogin: 'org', isPrivate: false, defaultBranch: 'main', addedAt: '2025-01-01', removedAt: null, githubId: 102, repoCreatedAt: null },
  ]),
}));

// ── Import subject after mocks ────────────────────────────────────────────────

import { buildExportBundle } from '../services/export-service.js';
import { getAiMarkerDate } from '../services/analytics-config.js';
import { getCohortCommitMetrics } from '../services/analytics-cohorts.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

const BASE_REQUEST = {
  startDate: '2025-01-01T00:00:00.000Z',
  endDate: '2025-12-31T23:59:59.000Z',
  repoIds: [],
  tenureMode: 'global' as const,
  rollingGranularity: 'month' as const,
};

// ── Test suites ───────────────────────────────────────────────────────────────

describe('buildExportBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an object with all 12 expected top-level keys', () => {
    const bundle = buildExportBundle(BASE_REQUEST);
    expect(bundle).toHaveProperty('metadata');
    expect(bundle).toHaveProperty('cohortCommits');
    expect(bundle).toHaveProperty('cohortPrs');
    expect(bundle).toHaveProperty('rampUp');
    expect(bundle).toHaveProperty('rolling');
    expect(bundle).toHaveProperty('contributors');
    expect(bundle).toHaveProperty('prTurnaround');
    expect(bundle).toHaveProperty('botRatio');
    expect(bundle).toHaveProperty('executiveSummary');
    expect(bundle).toHaveProperty('periodMetrics');
    expect(bundle).toHaveProperty('concentrationMonthly');
    expect(bundle).toHaveProperty('headcountMonthly');
  });

  it('metadata.toolVersion matches package.json version', () => {
    const bundle = buildExportBundle(BASE_REQUEST);
    // package.json version is "1.0.0"
    expect(bundle.metadata.toolVersion).toBe('1.0.0');
  });

  it('metadata.exportTimestamp is a valid ISO string', () => {
    const bundle = buildExportBundle(BASE_REQUEST);
    const ts = bundle.metadata.exportTimestamp;
    expect(typeof ts).toBe('string');
    expect(ts.endsWith('Z')).toBe(true);
    expect(isNaN(new Date(ts).getTime())).toBe(false);
  });

  it('metadata.repoNames is populated from tracked repos when repoIds is empty', () => {
    const bundle = buildExportBundle(BASE_REQUEST);
    expect(bundle.metadata.repoNames).toEqual(['org/repo-one', 'org/repo-two']);
  });

  it('metadata.repoNames filters to requested repoIds when specified', () => {
    const bundle = buildExportBundle({ ...BASE_REQUEST, repoIds: [1] });
    expect(bundle.metadata.repoNames).toEqual(['org/repo-one']);
  });

  it('periodMetrics is an array when getAiMarkerDate returns null', () => {
    vi.mocked(getAiMarkerDate).mockReturnValue(null);
    const bundle = buildExportBundle(BASE_REQUEST);
    expect(Array.isArray(bundle.periodMetrics)).toBe(true);
  });

  it('metadata.aiMarkerDate is null when no AI marker is set', () => {
    vi.mocked(getAiMarkerDate).mockReturnValue(null);
    const bundle = buildExportBundle(BASE_REQUEST);
    expect(bundle.metadata.aiMarkerDate).toBeNull();
  });

  it('metadata.aiMarkerDate is formatted as YYYY-MM-DD when AI marker is set', () => {
    vi.mocked(getAiMarkerDate).mockReturnValue(new Date('2025-06-01T00:00:00.000Z'));
    const bundle = buildExportBundle(BASE_REQUEST);
    expect(bundle.metadata.aiMarkerDate).toBe('2025-06-01');
  });

  it('returns empty array for cohortCommits when service throws', () => {
    vi.mocked(getCohortCommitMetrics).mockImplementationOnce(() => {
      throw new Error('DB error');
    });
    const bundle = buildExportBundle(BASE_REQUEST);
    expect(bundle.cohortCommits).toEqual([]);
  });

  it('individual section failure does not throw — returns empty/null for that section only', () => {
    // Make multiple services fail
    vi.mocked(getCohortCommitMetrics).mockImplementationOnce(() => {
      throw new Error('failure');
    });
    // Should not throw
    expect(() => buildExportBundle(BASE_REQUEST)).not.toThrow();
    const bundle = buildExportBundle(BASE_REQUEST);
    // Other sections should still be populated
    expect(bundle.executiveSummary).not.toBeNull();
  });

  it('metadata.startDate and endDate match request values', () => {
    const bundle = buildExportBundle(BASE_REQUEST);
    expect(bundle.metadata.startDate).toBe(BASE_REQUEST.startDate);
    expect(bundle.metadata.endDate).toBe(BASE_REQUEST.endDate);
  });

  it('metadata.tenureMode matches request', () => {
    const bundle = buildExportBundle({ ...BASE_REQUEST, tenureMode: 'repo' });
    expect(bundle.metadata.tenureMode).toBe('repo');
  });

  it('metadata.rollingGranularity matches request', () => {
    const bundle = buildExportBundle({ ...BASE_REQUEST, rollingGranularity: 'quarter' });
    expect(bundle.metadata.rollingGranularity).toBe('quarter');
  });

  it('metadata.cohortConfig has 3 thresholds', () => {
    const bundle = buildExportBundle(BASE_REQUEST);
    expect(bundle.metadata.cohortConfig.thresholds).toHaveLength(3);
  });
});

// ── 9.4 bundle shape assertions ───────────────────────────────────────────────
// Verify the new sections added by Phase 9.4: periodMetrics replaces
// beforeAfter, and concentrationMonthly + headcountMonthly are added.

describe('9.4 bundle shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bundle includes periodMetrics as an array', () => {
    const bundle = buildExportBundle(BASE_REQUEST);
    expect(Array.isArray(bundle.periodMetrics)).toBe(true);
  });

  it('bundle includes concentrationMonthly as an array', () => {
    const bundle = buildExportBundle(BASE_REQUEST);
    expect(Array.isArray(bundle.concentrationMonthly)).toBe(true);
  });

  it('bundle includes headcountMonthly as an array', () => {
    const bundle = buildExportBundle(BASE_REQUEST);
    expect(Array.isArray(bundle.headcountMonthly)).toBe(true);
  });

  it('bundle does NOT include beforeAfter key', () => {
    const bundle = buildExportBundle(BASE_REQUEST);
    expect('beforeAfter' in bundle).toBe(false);
  });
});
