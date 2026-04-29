import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@shared/components/ui/collapsible.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select.js';
import { DeveloperMiniChart, type DeveloperMiniChartDatum } from './DeveloperMiniChart.js';
import type { DeveloperMetricOption } from '@shared/lib/narratives.js';
import type { DeveloperWithRows } from './DeveloperTrajectoryGrid.js';

/**
 * Phase 9.5 (D-01 Layout C, D-06): list + inline-expand for >8 active devs.
 *
 * SORT EXCLUSION (D-06): Only Name and Tenure-Joined-Date are sortable. Volume
 * columns (prCount, commitCount, linesPerCommit, filesPerCommit) are
 * INTENTIONALLY NOT exposed as sort options — sorting by output is an
 * ADR-2 leaderboard risk and is privacy-protectively excluded.
 *
 * Default sort: Tenure descending (longest-tenured first).
 */

type SortKey = 'tenure-desc' | 'tenure-asc' | 'name-asc' | 'name-desc';

interface DeveloperTrajectoryListProps {
  developers: DeveloperWithRows[];
  metric: DeveloperMetricOption;
  aiMarkerMonth: string | null;
  cohortMeanByMonthAndCohort: Map<string, Map<string, number | null>>;
  onChartClick: (authorLogin: string) => void;
  isLoading?: boolean;
}

export function DeveloperTrajectoryList({
  developers,
  metric,
  aiMarkerMonth,
  cohortMeanByMonthAndCohort,
  onChartClick,
  isLoading = false,
}: DeveloperTrajectoryListProps) {
  const [sortKey, setSortKey] = useState<SortKey>('tenure-desc');

  const sorted = [...developers].sort((a, b) => {
    switch (sortKey) {
      case 'tenure-desc':
        return (a.tenureJoinedAt ?? '9999').localeCompare(b.tenureJoinedAt ?? '9999');
      case 'tenure-asc':
        return (b.tenureJoinedAt ?? '0000').localeCompare(a.tenureJoinedAt ?? '0000');
      case 'name-asc':
        return a.authorLogin.localeCompare(b.authorLogin);
      case 'name-desc':
        return b.authorLogin.localeCompare(a.authorLogin);
    }
  });

  return (
    <div className="space-y-2">
      {/* Sort selector — D-06: ONLY Name and Tenure-Joined-Date offered */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Sort by:</span>
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="h-7 text-xs w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tenure-desc">Tenure (newest first)</SelectItem>
            <SelectItem value="tenure-asc">Tenure (oldest first)</SelectItem>
            <SelectItem value="name-asc">Name (A→Z)</SelectItem>
            <SelectItem value="name-desc">Name (Z→A)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List rows */}
      {sorted.map(dev => (
        <DeveloperListRow
          key={dev.authorLogin}
          dev={dev}
          metric={metric}
          aiMarkerMonth={aiMarkerMonth}
          cohortMeanByMonthAndCohort={cohortMeanByMonthAndCohort}
          onChartClick={onChartClick}
          isLoading={isLoading}
        />
      ))}
    </div>
  );
}

interface DeveloperListRowProps {
  dev: DeveloperWithRows;
  metric: DeveloperMetricOption;
  aiMarkerMonth: string | null;
  cohortMeanByMonthAndCohort: Map<string, Map<string, number | null>>;
  onChartClick: (authorLogin: string) => void;
  isLoading: boolean;
}

function DeveloperListRow({
  dev,
  metric,
  aiMarkerMonth,
  cohortMeanByMonthAndCohort,
  onChartClick,
  isLoading,
}: DeveloperListRowProps) {
  const [open, setOpen] = useState(false);

  const data: DeveloperMiniChartDatum[] = dev.rows.map(r => ({
    month: r.month,
    value: getMetricValue(r, metric),
    cohortMean: cohortMeanByMonthAndCohort.get(dev.cohortKey)?.get(r.month) ?? null,
  }));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 rounded-md transition-colors">
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="text-sm font-medium">{dev.authorLogin}</span>
          {dev.tenureJoinedAt && (
            <span className="text-xs text-muted-foreground">
              Joined {dev.tenureJoinedAt.slice(0, 7)}
            </span>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-2 pb-4 px-2">
          <DeveloperMiniChart
            authorLogin={dev.authorLogin}
            data={data}
            metric={metric}
            aiMarkerMonth={aiMarkerMonth}
            isLoading={isLoading}
            compact={false}
            onClick={onChartClick}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function getMetricValue(row: { prCount: number; commitCount: number; meanLinesPerCommit: number | null; meanFilesPerCommit: number | null }, metric: DeveloperMetricOption): number | null {
  switch (metric) {
    case 'prCount': return row.prCount;
    case 'commitCount': return row.commitCount;
    case 'linesPerCommit': return row.meanLinesPerCommit;
    case 'filesPerCommit': return row.meanFilesPerCommit;
  }
}
