/**
 * Multi-org test data generator tests.
 * Validates that generated ExportBundles match expected characteristics
 * for each of the 3 org types.
 */

import { describe, it, expect } from 'vitest';
import {
  generateSmallStartup,
  generateMidSizeCompany,
  generatePreAiBaseline,
  generateAllTestOrgs,
} from '../services/test-data-generator.js';
import { ExportBundleSchema } from '../services/validation.js';

describe('Test data generator', () => {
  describe('generateSmallStartup', () => {
    it('produces ExportBundle with 5-15 contributors', () => {
      const bundle = generateSmallStartup();
      expect(bundle.contributors.length).toBeGreaterThanOrEqual(5);
      expect(bundle.contributors.length).toBeLessThanOrEqual(15);
    });

    it('has 1-3 repos in metadata', () => {
      const bundle = generateSmallStartup();
      expect(bundle.metadata.repoNames.length).toBeGreaterThanOrEqual(1);
      expect(bundle.metadata.repoNames.length).toBeLessThanOrEqual(3);
    });

    it('has a non-null aiMarkerDate', () => {
      const bundle = generateSmallStartup();
      expect(bundle.metadata.aiMarkerDate).not.toBeNull();
      expect(typeof bundle.metadata.aiMarkerDate).toBe('string');
    });

    it('has 12+ months of data in cohortCommits', () => {
      const bundle = generateSmallStartup();
      const months = new Set(bundle.cohortCommits.map(r => r.periodMonth));
      expect(months.size).toBeGreaterThanOrEqual(12);
    });

    it('passes ExportBundleSchema validation', () => {
      const bundle = generateSmallStartup();
      const result = ExportBundleSchema.safeParse(bundle);
      if (!result.success) {
        console.error('Validation errors:', result.error.issues);
      }
      expect(result.success).toBe(true);
    });

    it('has non-null executiveSummary and periodMetrics (has AI marker)', () => {
      const bundle = generateSmallStartup();
      expect(bundle.executiveSummary).not.toBeNull();
      expect(bundle.periodMetrics).not.toBeNull();
    });

    it('has ramp-up data with 3 distinct join periods', () => {
      const bundle = generateSmallStartup();
      expect(bundle.rampUp.length).toBeGreaterThan(0);
      const periods = new Set(bundle.rampUp.map(r => r.joinPeriod));
      expect(periods.size).toBe(3);
    });

    it('has 12 weeks per join period in ramp-up', () => {
      const bundle = generateSmallStartup();
      const periods = [...new Set(bundle.rampUp.map(r => r.joinPeriod))];
      for (const period of periods) {
        const weeks = bundle.rampUp.filter(r => r.joinPeriod === period);
        expect(weeks).toHaveLength(12);
        // Week indexes should be 0-11
        const indexes = weeks.map(w => w.weekIndex).sort((a, b) => a - b);
        expect(indexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      }
    });

    it('ramp-up avgLinesChanged generally increases across weeks', () => {
      const bundle = generateSmallStartup();
      const firstPeriod = bundle.rampUp.filter(r => r.joinPeriod === bundle.rampUp[0].joinPeriod);
      // Week 0 should be lower than week 10 (allowing jitter)
      expect(firstPeriod[10].avgLinesChanged).toBeGreaterThan(firstPeriod[0].avgLinesChanged);
    });

    it('ramp-up has valid numeric fields on every row', () => {
      const bundle = generateSmallStartup();
      for (const row of bundle.rampUp) {
        expect(typeof row.weekIndex).toBe('number');
        expect(row.weekIndex).toBeGreaterThanOrEqual(0);
        expect(typeof row.avgLinesChanged).toBe('number');
        expect(row.avgLinesChanged).toBeGreaterThanOrEqual(0);
        expect(typeof row.avgFilesChanged).toBe('number');
        expect(row.avgFilesChanged).toBeGreaterThanOrEqual(1);
        expect(typeof row.contributionCount).toBe('number');
        expect(row.contributionCount).toBeGreaterThan(0);
        expect(typeof row.contributorCount).toBe('number');
        expect(row.contributorCount).toBeGreaterThan(0);
        expect(typeof row.joinPeriod).toBe('string');
        expect(row.joinPeriod).toMatch(/^\d{4}-Q[1-4]$/);
      }
    });
  });

  describe('generateMidSizeCompany', () => {
    it('produces ExportBundle with 50-150 contributors', () => {
      const bundle = generateMidSizeCompany();
      expect(bundle.contributors.length).toBeGreaterThanOrEqual(50);
      expect(bundle.contributors.length).toBeLessThanOrEqual(150);
    });

    it('has 10-30 repos in metadata', () => {
      const bundle = generateMidSizeCompany();
      expect(bundle.metadata.repoNames.length).toBeGreaterThanOrEqual(10);
      expect(bundle.metadata.repoNames.length).toBeLessThanOrEqual(30);
    });

    it('has a mix of tenure cohorts (not all same cohort)', () => {
      const bundle = generateMidSizeCompany();
      const cohorts = new Set(bundle.contributors.map(c => c.cohort));
      expect(cohorts.size).toBeGreaterThan(1);
    });

    it('has 12+ months of data', () => {
      const bundle = generateMidSizeCompany();
      const months = new Set(bundle.cohortCommits.map(r => r.periodMonth));
      expect(months.size).toBeGreaterThanOrEqual(12);
    });

    it('passes ExportBundleSchema validation', () => {
      const bundle = generateMidSizeCompany();
      const result = ExportBundleSchema.safeParse(bundle);
      if (!result.success) {
        console.error('Validation errors:', result.error.issues);
      }
      expect(result.success).toBe(true);
    });

    it('has ramp-up data with 3 distinct join periods', () => {
      const bundle = generateMidSizeCompany();
      const periods = new Set(bundle.rampUp.map(r => r.joinPeriod));
      expect(periods.size).toBe(3);
    });

    it('ramp-up has 36 total rows (12 weeks x 3 periods)', () => {
      const bundle = generateMidSizeCompany();
      expect(bundle.rampUp).toHaveLength(36);
    });
  });

  describe('generatePreAiBaseline', () => {
    it('has aiMarkerDate === null (CRITICAL: control group)', () => {
      const bundle = generatePreAiBaseline();
      expect(bundle.metadata.aiMarkerDate).toBeNull();
    });

    it('has periodMetrics === null (no AI marker means no period metrics)', () => {
      const bundle = generatePreAiBaseline();
      expect(bundle.periodMetrics).toBeNull();
    });

    it('has 12+ months of data', () => {
      const bundle = generatePreAiBaseline();
      const months = new Set(bundle.cohortCommits.map(r => r.periodMonth));
      expect(months.size).toBeGreaterThanOrEqual(12);
    });

    it('passes ExportBundleSchema validation', () => {
      const bundle = generatePreAiBaseline();
      const result = ExportBundleSchema.safeParse(bundle);
      if (!result.success) {
        console.error('Validation errors:', result.error.issues);
      }
      expect(result.success).toBe(true);
    });

    it('has ramp-up data with 3 distinct join periods', () => {
      const bundle = generatePreAiBaseline();
      const periods = new Set(bundle.rampUp.map(r => r.joinPeriod));
      expect(periods.size).toBe(3);
    });

    it('executiveSummary has null aiAdoptionDelta (no AI to measure)', () => {
      const bundle = generatePreAiBaseline();
      // executiveSummary can be non-null, but aiAdoptionDelta should be null
      if (bundle.executiveSummary) {
        expect(bundle.executiveSummary.aiAdoptionDelta).toBeNull();
      }
    });
  });

  describe('Phase 9.4.2 regression guards', () => {
    it('topContributor varies across months within a generated small-startup org', () => {
      const bundle = generateSmallStartup();
      const tops = new Set(bundle.concentrationMonthly.map(r => r.topContributor).filter(Boolean));
      expect(tops.size).toBeGreaterThan(1);
    });

    it('top-1 shares on prs/commits/lines bases are in [45, 55] for dominant-window months (small startup) — W-6', () => {
      const bundle = generateSmallStartup();
      // D-07 / truth #3: for the 3 dominant-window months, top1Share on all 3 bases is in [45, 55]
      // AND the same topContributor wins on all 3 bases (cross-basis consistency).
      const byMonthBasis = new Map<string, Map<string, { share: number; login: string | null }>>();
      for (const row of bundle.concentrationMonthly) {
        if (!byMonthBasis.has(row.month)) byMonthBasis.set(row.month, new Map());
        byMonthBasis.get(row.month)!.set(row.basis, { share: row.top1Share ?? 0, login: row.topContributor });
      }
      // Collect months where ALL 3 bases have top1Share in [45, 55] AND the same topContributor
      const dominantMonths: string[] = [];
      for (const [month, shares] of byMonthBasis) {
        const prs = shares.get('prs');
        const commits = shares.get('commits');
        const lines = shares.get('lines');
        if (!prs || !commits || !lines) continue;
        const inRange = (v: number) => v >= 45 && v <= 55;
        const sameLogin = prs.login === commits.login && commits.login === lines.login && prs.login !== null;
        if (inRange(prs.share) && inRange(commits.share) && inRange(lines.share) && sameLogin) {
          dominantMonths.push(month);
        }
      }
      expect(
        dominantMonths.length,
        `Expected ~3 dominant-window months with top1Share in [45, 55] on all bases; got ${dominantMonths.length}`,
      ).toBeGreaterThanOrEqual(3);
    });

    it('D-09 toggle: generateMidSizeCompany has a team-size step (>= 3-dev month-over-month drop) — W-5', () => {
      const bundle = generateMidSizeCompany();  // default includeTeamSizeStep: true
      let biggestDrop = 0;
      for (let i = 1; i < bundle.headcountMonthly.length; i++) {
        const drop = bundle.headcountMonthly[i - 1].activeDevs - bundle.headcountMonthly[i].activeDevs;
        if (drop > biggestDrop) biggestDrop = drop;
      }
      expect(
        biggestDrop,
        `Expected mid-size org to have a month-over-month activeDevs drop >= 3; biggest drop = ${biggestDrop}`,
      ).toBeGreaterThanOrEqual(3);
    });

    it('D-09 toggle: generateMidSizeCompany({ includeTeamSizeStep: false }) has no step-drop', () => {
      const bundle = generateMidSizeCompany({ includeTeamSizeStep: false });
      // With toggle off, the largest month-over-month activeDevs drop should be small (just jitter)
      let biggestDrop = 0;
      for (let i = 1; i < bundle.headcountMonthly.length; i++) {
        const drop = bundle.headcountMonthly[i - 1].activeDevs - bundle.headcountMonthly[i].activeDevs;
        if (drop > biggestDrop) biggestDrop = drop;
      }
      expect(biggestDrop, `Expected <= 2-dev drop when toggle is off; got ${biggestDrop}`).toBeLessThanOrEqual(2);
    });

    it('D-09 toggle: generatePreAiBaseline stays clean regardless of options', () => {
      // Attempting to enable scenarios on pre-AI should still produce a clean control-group bundle
      const bundle = generatePreAiBaseline({ includeDominantWindow: true, includeBotStormMonth: true, includeTeamSizeStep: true });
      expect(bundle.metadata.aiMarkerDate).toBeNull();  // aiMarkerMonth: null is hard-coded in the generator body
      expect(bundle.periodMetrics).toBeNull();           // helper returns null when marker is null
      // Note: this test intentionally documents that the toggles do NOT override the pre-AI baseline's
      // structural invariants (aiMarkerDate=null, periodMetrics=null). The toggle values only affect
      // the profile's dominantWindow / headcountSchedule fields, but the aiMarkerMonth:null regression
      // guard is enforced by buildPeriodMetricsFromProfile returning null when aiMarkerDate is null.
    });

    it('periodMetrics values are derived, not hardcoded 150/180', () => {
      const bundle = generateSmallStartup();
      expect(bundle.periodMetrics).not.toBeNull();
      expect(bundle.periodMetrics![0].metrics.avgCommitSize).not.toBe(150);
      expect(bundle.periodMetrics![1].metrics.avgCommitSize).not.toBe(180);
    });

    it('generatePreAiBaseline has null aiMarkerDate and null periodMetrics', () => {
      const bundle = generatePreAiBaseline();
      expect(bundle.metadata.aiMarkerDate).toBeNull();
      expect(bundle.periodMetrics).toBeNull();
    });

    it('small + mid orgs have a bot-storm month (botPercentage >= 50)', () => {
      const small = generateSmallStartup();
      const mid = generateMidSizeCompany();
      expect(small.botRatio.some(r => r.botPercentage >= 50)).toBe(true);
      expect(mid.botRatio.some(r => r.botPercentage >= 50)).toBe(true);
    });

    it('pre-AI baseline does NOT have a bot-storm month', () => {
      const preAi = generatePreAiBaseline();
      expect(preAi.botRatio.every(r => r.botPercentage < 50)).toBe(true);
    });
  });

  describe('generateAllTestOrgs', () => {
    it('returns exactly 3 bundles', () => {
      const orgs = generateAllTestOrgs();
      expect(orgs).toHaveLength(3);
    });

    it('each entry has label, bundle, and sizeCategory', () => {
      const orgs = generateAllTestOrgs();
      for (const org of orgs) {
        expect(org.label).toBeTruthy();
        expect(org.bundle).toBeDefined();
        expect(org.sizeCategory).toBeTruthy();
      }
    });

    it('all 3 bundles pass ExportBundleSchema validation', () => {
      const orgs = generateAllTestOrgs();
      for (const org of orgs) {
        const result = ExportBundleSchema.safeParse(org.bundle);
        expect(result.success).toBe(true);
      }
    });

    it('small startup has higher avg commit rate per person than mid-size', () => {
      const orgs = generateAllTestOrgs();
      const startup = orgs.find(o => o.sizeCategory === 'small');
      const midSize = orgs.find(o => o.sizeCategory === 'medium');

      expect(startup).toBeDefined();
      expect(midSize).toBeDefined();

      // Commits per contributor: startup should have higher rate
      const startupBundle = startup!.bundle;
      const midSizeBundle = midSize!.bundle;

      const startupContributors = startupBundle.contributors.length;
      const midSizeContributors = midSizeBundle.contributors.length;

      const startupTotalCommits = startupBundle.cohortCommits.reduce((s, r) => s + r.totalCount, 0);
      const midSizeTotalCommits = midSizeBundle.cohortCommits.reduce((s, r) => s + r.totalCount, 0);

      const startupRate = startupTotalCommits / startupContributors;
      const midSizeRate = midSizeTotalCommits / midSizeContributors;

      expect(startupRate).toBeGreaterThan(midSizeRate);
    });
  });
});
