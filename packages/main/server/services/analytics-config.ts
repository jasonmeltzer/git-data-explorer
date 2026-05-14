import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appConfig } from '../db/schema.js';

const AI_MARKER_KEY = 'ai_adoption_marker';
const CYCLE_TIME_MAX_DAYS_KEY = 'cycle_time_max_days';
const DEFAULT_CYCLE_TIME_MAX_DAYS = 90;

/**
 * Get the AI adoption marker date from app_config.
 * Returns null when no marker has been set.
 */
export function getAiMarkerDate(): Date | null {
  const row = db.select().from(appConfig).where(eq(appConfig.key, AI_MARKER_KEY)).get();
  if (!row) return null;
  const date = new Date(row.value);
  if (isNaN(date.getTime())) return null;
  return date;
}

/**
 * Set or clear the AI adoption marker date.
 * Pass null to clear the marker (deletes the config row).
 * Pass a Date to store it as an ISO string.
 */
export function setAiMarkerDate(date: Date | null): void {
  if (date === null) {
    db.delete(appConfig).where(eq(appConfig.key, AI_MARKER_KEY)).run();
    return;
  }
  db.insert(appConfig)
    .values({
      key: AI_MARKER_KEY,
      value: date.toISOString(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: {
        value: date.toISOString(),
        updatedAt: new Date(),
      },
    })
    .run();
}

/**
 * Get the cycle-time outlier cap in days. Default 90 (D-08).
 * PRs with `mergedAt - firstCommitAt > cap` are excluded from cycle-time medians
 * but remain in the PR table tagged as outliers.
 * The cap is applied at query time, not collection time — changing it retroactively
 * adjusts which PRs are in the metric (intentional, per D-08 — useful for sensitivity analysis).
 */
export function getCycleTimeMaxDays(): number {
  const row = db.select().from(appConfig).where(eq(appConfig.key, CYCLE_TIME_MAX_DAYS_KEY)).get();
  if (!row) return DEFAULT_CYCLE_TIME_MAX_DAYS;
  const n = parseInt(row.value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 365) return DEFAULT_CYCLE_TIME_MAX_DAYS;
  return n;
}

/**
 * Set the cycle-time outlier cap in days. Validates 1 <= days <= 365.
 */
export function setCycleTimeMaxDays(days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('cycle_time_max_days must be an integer between 1 and 365');
  }
  db.insert(appConfig)
    .values({ key: CYCLE_TIME_MAX_DAYS_KEY, value: String(days), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: String(days), updatedAt: new Date() },
    })
    .run();
}
