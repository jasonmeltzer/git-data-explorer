/**
 * Shared delta formatting utilities used by BeforeAfterComparison and ContributorTable.
 */

/**
 * Calculate a percentage delta string and polarity for display.
 * @param before - baseline value
 * @param after - comparison value
 * @param lowerIsBetter - if true, a decrease is shown as positive (green)
 */
export function pctDelta(before: number, after: number, lowerIsBetter = false): { str: string; positive: boolean } {
  if (before === 0) return { str: 'N/A', positive: true };
  const pct = ((after - before) / before) * 100;
  const rounded = Math.round(pct);
  return {
    str: rounded >= 0 ? `+${rounded}%` : `${rounded}%`,
    positive: lowerIsBetter ? pct <= 0 : pct >= 0,
  };
}

/**
 * Format a number for display in delta columns.
 * - Values with absolute value < 1 (and non-zero) get 2 decimal places.
 * - Values with absolute value < 100 get 1 decimal place.
 * - Larger values are rounded and locale-formatted.
 */
export function formatNum(n: number): string {
  if (n !== 0 && Math.abs(n) < 1) return n.toFixed(2);
  if (Math.abs(n) < 100) return n.toFixed(1);
  return Math.round(n).toLocaleString();
}
