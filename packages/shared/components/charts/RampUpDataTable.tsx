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
import type { RampUpBucket } from '@shared/types.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@shared/components/ui/table.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';

interface RampUpDataTableProps {
  data: RampUpBucket[];
  isFetching: boolean;
}

// Pivots RampUpBucket[] by weekIndex, one column per joinPeriod
export function RampUpDataTable({ data, isFetching }: RampUpDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const joinPeriods = useMemo(
    () => [...new Set(data.map((r) => r.joinPeriod))].sort(),
    [data],
  );

  const pivoted = useMemo(() => {
    const byWeek = new Map<number, Record<string, unknown>>();
    for (const row of data) {
      if (!byWeek.has(row.weekIndex)) {
        byWeek.set(row.weekIndex, { weekIndex: row.weekIndex });
      }
      (byWeek.get(row.weekIndex) as Record<string, unknown>)[row.joinPeriod] = row.avgLinesChanged;
    }
    return [...byWeek.values()].sort(
      (a, b) => (a.weekIndex as number) - (b.weekIndex as number),
    );
  }, [data]);

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        accessorKey: 'weekIndex',
        header: 'Week #',
        enableSorting: true,
        meta: { align: 'right' as const },
        cell: ({ getValue }: { getValue: () => unknown }) => (
          <span className="tabular-nums">{String(getValue())}</span>
        ),
      },
      ...joinPeriods.map((jp) => ({
        accessorKey: jp,
        header: jp,
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
    [joinPeriods],
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
        <p className="text-sm text-muted-foreground">No ramp-up data for selected filters.</p>
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
