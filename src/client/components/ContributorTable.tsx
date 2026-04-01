import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

import { useContributors } from '../hooks/useContributors.js';
import type { ContributorStats, CohortLabel } from '@shared/types.js';
import { cohortColorMap } from '@shared/cohort-config.js';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@shared/components/ui/collapsible.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@shared/components/ui/table.js';
import { Badge } from '@shared/components/ui/badge.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';

interface ContributorTableProps {
  startDate: string;
  endDate: string;
  tenureMode: 'global' | 'repo';
  repoIds: number[];
}

const columns: ColumnDef<ContributorStats>[] = [
  {
    accessorKey: 'authorLogin',
    header: 'Author',
    enableSorting: true,
  },
  {
    accessorKey: 'cohort',
    header: 'Cohort',
    enableSorting: true,
    cell: ({ getValue }) => {
      const cohort = getValue<CohortLabel>();
      return (
        <Badge
          style={{ backgroundColor: cohortColorMap[cohort], color: '#fff', border: 'none' }}
        >
          {cohort}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'totalCommits',
    header: 'Commits',
    enableSorting: true,
    meta: { align: 'right' },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{getValue<number>().toLocaleString()}</span>
    ),
  },
  {
    accessorKey: 'totalPrs',
    header: 'PRs',
    enableSorting: true,
    meta: { align: 'right' },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{getValue<number>().toLocaleString()}</span>
    ),
  },
  {
    accessorKey: 'avgLinesAdded',
    header: 'Avg Lines Added',
    enableSorting: true,
    meta: { align: 'right' },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{Math.round(getValue<number>()).toLocaleString()}</span>
    ),
  },
  {
    accessorKey: 'avgLinesDeleted',
    header: 'Avg Lines Deleted',
    enableSorting: true,
    meta: { align: 'right' },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{Math.round(getValue<number>()).toLocaleString()}</span>
    ),
  },
  {
    accessorKey: 'avgFilesChanged',
    header: 'Avg Files',
    enableSorting: true,
    meta: { align: 'right' },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{getValue<number>().toFixed(1)}</span>
    ),
  },
  {
    accessorKey: 'firstCommitAt',
    header: 'First Commit',
    enableSorting: true,
    cell: ({ getValue }) => {
      const val = getValue<string>();
      return format(new Date(val), 'MMM yyyy');
    },
  },
];

export function ContributorTable({ startDate, endDate, tenureMode, repoIds }: ContributorTableProps) {
  const [open, setOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'totalCommits', desc: true }]);

  const { data: contributors, isFetching } = useContributors({
    startDate,
    endDate,
    tenureMode,
    repoIds,
  });

  const table = useReactTable({
    data: contributors ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">Contribution Patterns by Author</h2>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {open ? (
            <>
              <ChevronUp className="h-4 w-4" />
              Hide contributors
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              Explore contributors
            </>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-4 overflow-x-auto">
            {isFetching ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : !contributors || contributors.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No contributor data for the selected filters.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => {
                        const isRightAligned =
                          (header.column.columnDef.meta as { align?: string } | undefined)?.align === 'right';
                        const sorted = header.column.getIsSorted();
                        return (
                          <TableHead
                            key={header.id}
                            className={isRightAligned ? 'text-right' : ''}
                          >
                            {header.column.getCanSort() ? (
                              <button
                                className="flex items-center gap-1 hover:text-foreground transition-colors"
                                style={isRightAligned ? { marginLeft: 'auto' } : undefined}
                                onClick={header.column.getToggleSortingHandler()}
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {sorted === 'asc' ? (
                                  <ArrowUp className="h-3 w-3" />
                                ) : sorted === 'desc' ? (
                                  <ArrowDown className="h-3 w-3" />
                                ) : (
                                  <ArrowUpDown className="h-3 w-3 opacity-50" />
                                )}
                              </button>
                            ) : (
                              flexRender(header.column.columnDef.header, header.getContext())
                            )}
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
                          <TableCell
                            key={cell.id}
                            className={isRightAligned ? 'text-right' : ''}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
