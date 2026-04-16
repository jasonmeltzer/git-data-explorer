import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { SortableHeader } from './SortableHeader.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@shared/components/ui/table.js';
import type { ConcentrationMonthlyRow } from '@shared/types.js';

interface TeamDistributionTableProps {
  data: ConcentrationMonthlyRow[];
}

const fmt = (v: number | null, digits: number, suffix = '') =>
  v == null ? '---' : `${v.toFixed(digits)}${suffix}`;

const TABLE_COLUMNS: ColumnDef<ConcentrationMonthlyRow>[] = [
  {
    accessorKey: 'month',
    header: 'Month',
    enableSorting: true,
  },
  {
    accessorKey: 'top1Share',
    header: 'Top-1 Share',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{fmt(getValue<number | null>(), 1, '%')}</span>
    ),
  },
  {
    accessorKey: 'top3Share',
    header: 'Top-3 Share',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{fmt(getValue<number | null>(), 1, '%')}</span>
    ),
  },
  {
    accessorKey: 'top5Share',
    header: 'Top-5 Share',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{fmt(getValue<number | null>(), 1, '%')}</span>
    ),
  },
  {
    accessorKey: 'hhi',
    header: 'HHI',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{fmt(getValue<number | null>(), 3)}</span>
    ),
  },
  {
    accessorKey: 'gini',
    header: 'Gini',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{fmt(getValue<number | null>(), 3)}</span>
    ),
  },
  {
    accessorKey: 'busFactor',
    header: 'Bus Factor',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => {
      const v = getValue<number | null>();
      return <span className="tabular-nums">{v == null ? '---' : String(Math.round(v))}</span>;
    },
  },
  {
    accessorKey: 'activeDevs',
    header: 'Active Devs',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{String(getValue<number>())}</span>
    ),
  },
];

export function TeamDistributionTable({ data }: TeamDistributionTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'month', desc: true }]);

  const table = useReactTable({
    data,
    columns: TABLE_COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  if (data.length === 0) {
    return (
      <div className="min-h-[120px] flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No concentration data available for this period.</p>
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
