/**
 * SQL safety primitives.
 *
 * Extracted from packages/main/server/services/analytics-utils.ts (SEC-01 precedent).
 * Both main and research packages must use these at every sql.raw interpolation site
 * to prevent SQL injection through non-integer values (SEC-07, SEC-09).
 */

/**
 * Filters an unknown[] to positive safe integers. Rejects:
 * non-number types, NaN/Infinity, floats, zero, negatives, MAX_SAFE_INTEGER+1 and larger.
 * Preserves order. Named to read as an assertion at call sites (defense-in-depth).
 */
export function assertIntegerArray(ids: unknown[]): number[] {
  return ids.filter((id): id is number =>
    typeof id === 'number' &&
    Number.isInteger(id) &&
    Number.isSafeInteger(id) &&
    id > 0
  );
}

/**
 * Renders a safe `IN (...)` clause body for sql.raw. Returns '' for empty input —
 * caller must guard (e.g., `if (!list) return [];`). Matches aggregation.ts join(',') format.
 */
export function sqlIntList(ids: number[]): string {
  const safe = assertIntegerArray(ids);
  return safe.join(',');
}
