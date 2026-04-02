import { useState, useMemo } from 'react';
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
import { useContributorBeforeAfter } from '../hooks/useContributorBeforeAfter.js';
import { pctDelta, formatNum } from '../lib/deltaFormat.js';
import type { ContributorStats, CohortLabel, ContributorBeforeAfterStats } from '@shared/types.js';
import { cohortColorMap, COHORT_LABELS } from '@shared/cohort-config.js';
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
  aiMarkerDate: string | null;
}

const baseColumns: ColumnDef<ContributorStats>[] = [
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
          {COHORT_LABELS[cohort] ?? cohort}
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

type NumericKey = 'totalCommits' | 'totalPrs' | 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged';

function makeDeltaColumns(
  metricKey: NumericKey,
  preHeader: string,
  postHeader: string,
  beforeAfterMap: Map<string, ContributorBeforeAfterStats>,
): ColumnDef<ContributorStats>[] {
  return [
    {
      id: `pre_${metricKey}`,
      header: preHeader,
      enableSorting: true,
      meta: { align: 'right' },
      accessorFn: (row) => beforeAfterMap.get(row.authorLogin)?.pre?.[metricKey] ?? null,
      sortingFn: (rowA, rowB, columnId) => {
        const a = rowA.getValue<number | null>(columnId);
        const b = rowB.getValue<number | null>(columnId);
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        return a - b;
      },
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v === null) return <span className="text-muted-foreground">—</span>;
        return <span className="tabular-nums">{formatNum(v)}</span>;
      },
    },
    {
      id: `post_${metricKey}`,
      header: postHeader,
      enableSorting: true,
      meta: { align: 'right' },
      accessorFn: (row) => beforeAfterMap.get(row.authorLogin)?.post?.[metricKey] ?? null,
      sortingFn: (rowA, rowB, columnId) => {
        const a = rowA.getValue<number | null>(columnId);
        const b = rowB.getValue<number | null>(columnId);
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        return a - b;
      },
      cell: ({ getValue }) => {
        const v = getValue<number | null>();
        if (v === null) return <span className="text-muted-foreground">—</span>;
        return <span className="tabular-nums">{formatNum(v)}</span>;
      },
    },
    {
      id: `change_${metricKey}`,
      header: 'Change',
      enableSorting: true,
      meta: { align: 'right' },
      accessorFn: (row) => {
        const ba = beforeAfterMap.get(row.authorLogin);
        const pre = ba?.pre?.[metricKey];
        const post = ba?.post?.[metricKey];
        if (pre == null || post == null) return null;
        if (pre === 0) return null;
        return ((post - pre) / pre) * 100;
      },
      sortingFn: (rowA, rowB, columnId) => {
        const a = rowA.getValue<number | null>(columnId);
        const b = rowB.getValue<number | null>(columnId);
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        return a - b;
      },
      cell: ({ row }) => {
        const ba = beforeAfterMap.get(row.original.authorLogin);
        const pre = ba?.pre?.[metricKey];
        const post = ba?.post?.[metricKey];
        if (pre == null && post == null) return <span className="text-muted-foreground">—</span>;
        if (pre == null || post == null) return <span className="text-muted-foreground">N/A</span>;
        const { str, positive } = pctDelta(pre, post);
        return (
          <span className={`tabular-nums ${positive ? 'text-emerald-500' : 'text-red-500'}`}>
            {Math.round(pre)} → {Math.round(post)} ({str})
          </span>
        );
      },
    },
  ];
}

export function ContributorTable({ startDate, endDate, tenureMode, repoIds, aiMarkerDate }: ContributorTableProps) {
  const [open, setOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'totalCommits', desc: true }]);

  const { data: contributors, isFetching } = useContributors({
    startDate,
    endDate,
    tenureMode,
    repoIds,
  });

  const { data: beforeAfterData } = useContributorBeforeAfter({
    startDate,
    endDate,
    tenureMode,
    repoIds,
    aiMarkerDate,
  });

  const beforeAfterMap = useMemo(() => {
    if (!beforeAfterData) return new Map<string, ContributorBeforeAfterStats>();
    return new Map(beforeAfterData.map(d => [d.authorLogin, d]));
  }, [beforeAfterData]);

  const allColumns = useMemo<ColumnDef<ContributorStats>[]>(() => {
    const base = [...baseColumns];

    if (!aiMarkerDate) return base;

    return [
      ...base,
      ...makeDeltaColumns('totalCommits', 'Pre-AI Commits', 'Post-AI Commits', beforeAfterMap),
      ...makeDeltaColumns('totalPrs', 'Pre-AI PRs', 'Post-AI PRs', beforeAfterMap),
      ...makeDeltaColumns('avgLinesAdded', 'Pre-AI Lines+', 'Post-AI Lines+', beforeAfterMap),
      ...makeDeltaColumns('avgLinesDeleted', 'Pre-AI Lines\u2212', 'Post-AI Lines\u2212', beforeAfterMap),
      ...makeDeltaColumns('avgFilesChanged', 'Pre-AI Files', 'Post-AI Files', beforeAfterMap),
    ];
  }, [aiMarkerDate, beforeAfterMap]);

  const table = useReactTable({
    data: contributors ?? [],
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Contribution Patterns by Author</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-3">How contribution patterns shifted after AI adoption</p>
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
          {!aiMarkerDate && (
            <div className="mt-3 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              Want to see how contribution patterns changed after AI adoption?{' '}
              <a href="#/settings" className="font-medium text-primary hover:underline">Set an AI adoption date in Settings</a> to add before/after comparison columns to this table.
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
