import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appConfig } from '../db/schema.js';
import { DEFAULT_COHORT_CONFIG, type CohortConfig, type CohortThreshold } from '../../shared/cohort-config.js';

const COHORT_CONFIG_KEY = 'cohort_config';

/**
 * Validate that a parsed object has the shape of a CohortConfig with 3 thresholds.
 * Returns true if valid, false otherwise.
 */
function isValidCohortConfig(obj: unknown): obj is CohortConfig {
  if (!obj || typeof obj !== 'object') return false;
  const c = obj as Record<string, unknown>;
  if (!Array.isArray(c.thresholds) || c.thresholds.length !== 3) return false;
  for (const t of c.thresholds) {
    if (!t || typeof t !== 'object') return false;
    const threshold = t as Record<string, unknown>;
    if (
      (threshold.maxMonths !== null && typeof threshold.maxMonths !== 'number') ||
      typeof threshold.key !== 'string' || threshold.key.length === 0 ||
      typeof threshold.label !== 'string' || threshold.label.length === 0 ||
      typeof threshold.color !== 'string' || threshold.color.length === 0
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Get the current cohort config from app_config.
 * Returns DEFAULT_COHORT_CONFIG if not set or if stored JSON is invalid.
 */
export function getCohortConfig(): CohortConfig {
  const row = db.select().from(appConfig).where(eq(appConfig.key, COHORT_CONFIG_KEY)).get();
  if (!row) return DEFAULT_COHORT_CONFIG;
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (isValidCohortConfig(parsed)) return parsed;
  } catch {
    // fall through to default
  }
  return DEFAULT_COHORT_CONFIG;
}

/**
 * Persist a cohort config to app_config.
 * Validates that:
 * - All 3 thresholds exist
 * - threshold[0].maxMonths < threshold[1].maxMonths (both positive numbers)
 * - threshold[2].maxMonths is null (unbounded last bucket)
 * - All labels are non-empty strings
 * Throws an error with a descriptive message if validation fails.
 */
export function setCohortConfig(config: CohortConfig): void {
  if (!isValidCohortConfig(config)) {
    throw new Error('Invalid cohort config: must have exactly 3 thresholds with key, label, color');
  }

  const [t0, t1, t2] = config.thresholds as [CohortThreshold, CohortThreshold, CohortThreshold];

  if (typeof t0.maxMonths !== 'number' || t0.maxMonths <= 0) {
    throw new Error('First threshold maxMonths must be a positive number');
  }
  if (typeof t1.maxMonths !== 'number' || t1.maxMonths <= 0) {
    throw new Error('Second threshold maxMonths must be a positive number');
  }
  if (t0.maxMonths >= t1.maxMonths) {
    throw new Error('First threshold must be less than second threshold');
  }
  if (t2.maxMonths !== null) {
    throw new Error('Last threshold maxMonths must be null (unbounded)');
  }

  const value = JSON.stringify(config);
  const updatedAt = new Date();

  db.insert(appConfig)
    .values({ key: COHORT_CONFIG_KEY, value, updatedAt })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt },
    })
    .run();
}
