import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { collectionState } from '../db/schema.js';
import { assertIntegerArray } from '@shared/lib/sql-safety.js';

/**
 * Returns IDs of repos where BOTH commits and pull_requests have status='complete'.
 * Optionally filtered to a specific set of repoIds.
 *
 * SAFETY: IDs are DB-sourced integers. The integer guard ensures no non-integer
 * values can reach downstream sql.raw interpolation (SEC-01 / SEC-07).
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

  // SEC-01 / SEC-07: single source of truth in packages/shared/lib/sql-safety.ts.
  const completeIds = assertIntegerArray(rows.map(r => r.repoId));

  if (!repoIds || repoIds.length === 0) return completeIds;
  const requested = new Set(repoIds);
  return completeIds.filter(id => requested.has(id));
}
