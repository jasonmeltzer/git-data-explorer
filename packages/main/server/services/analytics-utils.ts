import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { collectionState } from '../db/schema.js';

/**
 * Returns IDs of repos where BOTH commits and pull_requests have status='complete'.
 * Optionally filtered to a specific set of repoIds.
 *
 * SAFETY: IDs are DB-sourced integers. The integer guard ensures no non-integer
 * values can reach downstream sql.raw interpolation (SEC-01).
 */
export function getCompleteRepoIds(repoIds?: number[]): number[] {
  const rows = db
    .select({ repoId: collectionState.repoId })
    .from(collectionState)
    .where(
      and(
        eq(collectionState.status, 'complete'),
        inArray(collectionState.resourceType, ['commits', 'pull_requests']),
      )
    )
    .groupBy(collectionState.repoId)
    .having(sql`COUNT(*) >= 2`)
    .all();

  // Safety: ensure all IDs are positive integers before any sql.raw usage downstream (SEC-01)
  const completeIds = rows.map(r => r.repoId).filter(id => Number.isInteger(id) && id > 0);

  if (!repoIds || repoIds.length === 0) return completeIds;
  const requested = new Set(repoIds);
  return completeIds.filter(id => requested.has(id));
}
