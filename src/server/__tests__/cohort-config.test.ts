/**
 * Tests for cohort configurability.
 *
 * These tests are EXPECTED TO FAIL until Phase 7.1 makes cohort boundaries
 * configurable. They assert that cohort thresholds and labels are driven by
 * a shared config rather than hardcoded in multiple places.
 *
 * When implementing variable cohorts, create a shared config (e.g.
 * src/shared/cohort-config.ts) that exports the boundaries and labels,
 * then update all consumers to read from it. These tests will pass once
 * that refactor is complete.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');

function readSrc(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf-8');
}

describe('cohort configurability (expected to fail until Phase 7.1)', () => {
  it('a shared cohort config file exists', () => {
    // Phase 7.1 should create a single source of truth for cohort definitions
    let exists = false;
    try {
      readSrc('src/shared/cohort-config.ts');
      exists = true;
    } catch {
      // file doesn't exist yet
    }
    expect(exists, 'src/shared/cohort-config.ts should exist as the single source of truth for cohort boundaries and labels').toBe(true);
  });

  it('analytics-cohorts.ts imports cohort boundaries from shared config', () => {
    const source = readSrc('src/server/services/analytics-cohorts.ts');
    expect(
      source,
      'analytics-cohorts.ts should import from cohort-config instead of hardcoding THREE_MONTHS_S and TWELVE_MONTHS_S'
    ).toContain('cohort-config');
  });

  it('narratives.ts imports cohort labels from shared config', () => {
    const source = readSrc('src/client/lib/narratives.ts');
    expect(
      source,
      'narratives.ts should import COHORT_LABELS from cohort-config instead of defining them inline'
    ).toContain('cohort-config');
  });

  it('CohortAreaChart.tsx imports cohort config from shared config', () => {
    const source = readSrc('src/client/components/charts/CohortAreaChart.tsx');
    expect(
      source,
      'CohortAreaChart.tsx should import chartConfig from cohort-config instead of hardcoding senior/mid/new'
    ).toContain('cohort-config');
  });

  it('ContributorTable.tsx imports cohort color map from shared config', () => {
    const source = readSrc('src/client/components/ContributorTable.tsx');
    expect(
      source,
      'ContributorTable.tsx should import cohortColorMap from cohort-config instead of hardcoding it'
    ).toContain('cohort-config');
  });

  it('chartTransforms.ts uses dynamic cohort keys instead of hardcoded new/mid/senior', () => {
    const source = readSrc('src/client/lib/chartTransforms.ts');
    expect(
      source,
      'chartTransforms.ts should import cohort keys from cohort-config instead of hardcoding new/mid/senior properties'
    ).toContain('cohort-config');
  });

  it('CohortLabel type is derived from config, not a hardcoded union', () => {
    const source = readSrc('src/shared/types.ts');
    // Should NOT contain the hardcoded union type
    const hasHardcodedUnion = /CohortLabel\s*=\s*'0-3mo'\s*\|\s*'3-12mo'\s*\|\s*'1yr\+'/.test(source);
    expect(
      hasHardcodedUnion,
      'CohortLabel should be derived from cohort-config, not a hardcoded string union'
    ).toBe(false);
  });
});
