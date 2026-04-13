/**
 * RFC 4180 compliant CSV serialization utilities.
 *
 * RFC 4180 rules:
 * - Fields containing commas, double-quotes, or newlines MUST be enclosed in double-quotes.
 * - Double-quotes within a quoted field are escaped by doubling them: " → ""
 * - Each record is a line separated by CRLF, but LF-only is widely accepted.
 */

type CsvValue = string | number | null | undefined;

/**
 * Serialize a single row to a CSV line.
 *
 * @param values - Array of cell values (string, number, null, or undefined)
 * @returns Comma-separated string with RFC 4180 quoting applied
 */
export function toCsvRow(values: CsvValue[]): string {
  return values
    .map(v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      // If the string contains comma, double-quote, or newline — wrap in double-quotes
      // and escape internal double-quotes by doubling them.
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(',');
}

/**
 * Serialize a dataset (headers + rows) to a complete CSV string.
 *
 * @param headers - Column header labels
 * @param rows - Data rows, each an array of cell values
 * @returns Multi-line CSV string with header as first line
 */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [toCsvRow(headers)];
  for (const row of rows) {
    lines.push(toCsvRow(row));
  }
  return lines.join('\n');
}
