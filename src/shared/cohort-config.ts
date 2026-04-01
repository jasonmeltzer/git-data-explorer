/**
 * Single source of truth for cohort boundary definitions, labels, and colors.
 * All dashboard components and analytics queries must import from here.
 *
 * This module is shared between the server (analytics queries) and client
 * (chart components, narratives) — keep it free of server-only or client-only
 * imports.
 */

export interface CohortThreshold {
  maxMonths: number | null; // null = unbounded (last bucket)
  key: string;              // 'new', 'mid', 'senior'
  label: string;            // 'New (0-3mo)'
  color: string;            // CSS var reference
}

export interface CohortConfig {
  thresholds: [CohortThreshold, CohortThreshold, CohortThreshold];
}

export const DEFAULT_COHORT_CONFIG: CohortConfig = {
  thresholds: [
    { maxMonths: 3,    key: 'new',    label: 'New (0-3mo)',      color: 'var(--chart-cohort-new)'    },
    { maxMonths: 12,   key: 'mid',    label: 'Growing (3-12mo)', color: 'var(--chart-cohort-mid)'    },
    { maxMonths: null, key: 'senior', label: 'Senior (1yr+)',    color: 'var(--chart-cohort-senior)' },
  ],
};

/**
 * Ordered list of cohort keys: ['new', 'mid', 'senior']
 */
export const COHORT_KEYS: string[] = DEFAULT_COHORT_CONFIG.thresholds.map(t => t.key);

/**
 * Maps SQL output labels to display labels.
 * e.g. '0-3mo' -> 'New (0-3mo)', '3-12mo' -> 'Growing (3-12mo)', '1yr+' -> 'Senior (1yr+)'
 */
export const COHORT_LABELS: Record<string, string> = {
  '0-3mo':  'New (0-3mo)',
  '3-12mo': 'Growing (3-12mo)',
  '1yr+':   'Senior (1yr+)',
};

/**
 * Maps SQL output labels to CSS color variables.
 * e.g. '0-3mo' -> 'var(--chart-cohort-new)'
 */
export const cohortColorMap: Record<string, string> = {
  '0-3mo':  'var(--chart-cohort-new)',
  '3-12mo': 'var(--chart-cohort-mid)',
  '1yr+':   'var(--chart-cohort-senior)',
};

/**
 * Maps SQL output labels to cohort keys.
 * e.g. '0-3mo' -> 'new', '3-12mo' -> 'mid', '1yr+' -> 'senior'
 */
export const cohortSqlLabelToKey: Record<string, string> = {
  '0-3mo':  'new',
  '3-12mo': 'mid',
  '1yr+':   'senior',
};

/**
 * Chart config for Recharts ChartContainer — keyed by cohort key.
 * e.g. { new: { label: 'New (0-3mo)', color: 'var(--chart-cohort-new)' }, ... }
 */
export const cohortChartConfig: Record<string, { label: string; color: string }> =
  Object.fromEntries(
    DEFAULT_COHORT_CONFIG.thresholds.map(t => [t.key, { label: t.label, color: t.color }])
  );

/**
 * Returns threshold values in seconds for SQL CASE WHEN generation.
 * For the default 3-bucket config, returns [t1Seconds, t2Seconds].
 * The last bucket (maxMonths === null) is the ELSE clause.
 */
export function getThresholdSeconds(config: CohortConfig): number[] {
  return config.thresholds
    .filter(t => t.maxMonths !== null)
    .map(t => t.maxMonths! * 30 * 24 * 3600);
}
