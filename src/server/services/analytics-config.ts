import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appConfig } from '../db/schema.js';

const AI_MARKER_KEY = 'ai_adoption_marker';

/**
 * Get the AI adoption marker date from app_config.
 * Returns null when no marker has been set.
 */
export function getAiMarkerDate(): Date | null {
  const row = db.select().from(appConfig).where(eq(appConfig.key, AI_MARKER_KEY)).get();
  if (!row) return null;
  return new Date(row.value);
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
