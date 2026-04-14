import { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { SortableHeader } from './SortableHeader.js';
import { formatNum } from '@shared/lib/deltaFormat.js';
import type { CohortMetricsRow } from '@shared/types.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@shared/components/ui/table.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';

export type MetricOption = 'totalCount' | 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged';

interface CohortDataTableProps {
  data: CohortMetricsRow[];
  metric: MetricOption;
  isFetching: boolean;
  chartConfig: Record<string, { label: string; color: string }> | undefined;
}

// Pivots CohortMetricsRow[] by periodMonth, one column per cohort
export function CohortDataTable({ data, metric, isFetching, chartConfig }: CohortDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const cohortKeys = useMemo(() => [...new Set(data.map((r) => r.cohort))], [data]);

  const pivoted = useMemo(() => {
    const byMonth = new Map<string, Record<string, unknown>>();
    for (const row of data) {
      if (!byMonth.has(row.periodMonth)) {
        byMonth.set(row.periodMonth, { periodMonth: row.periodMonth });
      }
      (byMonth.get(row.periodMonth) as Record<string, unknown>)[row.cohort] = row[metric];
    }
    return [...byMonth.values()].sort((a, b) =>
      String(a.periodMonth).localeCompare(String(b.periodMonth)),
    );
  }, [data, metric]);

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      { accessorKey: 'periodMonth', header: 'Period', enableSorting: true },
      ...cohortKeys.map((key) => ({
        accessorKey: key,
        header: chartConfig?.[key]?.label ?? key,
        enableSorting: true,
        meta: { align: 'right' as const },
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const val = getValue() as number | undefined;
          return (
            <span className="tabular-nums">
              {val != null ? formatNum(val) : '—'}
            </span>
          );
        },
      })),
    ],
    [cohortKeys, chartConfig],
  );

  const table = useReactTable({
    data: pivoted,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  if (isFetching && data.length === 0) return <Skeleton className="h-[300px] w-full" />;

  if (data.length === 0) {
    return (
      <div className="min-h-[120px] flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No data for selected filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto mt-2">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const isRightAligned =
                  (header.column.columnDef.meta as { align?: string } | undefined)?.align === 'right';
                return (
                  <TableHead key={header.id} className={isRightAligned ? 'text-right' : ''}>
                    <SortableHeader header={header} isRightAligned={isRightAligned} />
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const isRightAligned =
                  (cell.column.columnDef.meta as { align?: string } | undefined)?.align === 'right';
                return (
                  <TableCell key={cell.id} className={isRightAligned ? 'text-right' : ''}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
