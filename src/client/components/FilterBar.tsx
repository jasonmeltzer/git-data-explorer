import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar } from '@shared/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shared/components/ui/popover';
import { Badge } from '@shared/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { cn } from '@shared/lib/utils';
import type { DatePreset } from '../hooks/useDashboardFilters';
import type { TrackedRepo } from '@shared/types.js';
import { CalendarIcon, CheckIcon, ChevronDownIcon, HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@shared/components/ui/tooltip';
import type { DateRange } from 'react-day-picker';

const DATE_PRESETS: { label: string; value: DatePreset }[] = [
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: '6mo', value: '6mo' },
  { label: '1yr', value: '1yr' },
  { label: 'All', value: 'all' },
];

interface FilterBarProps {
  preset: DatePreset;
  setPreset: (p: DatePreset) => void;
  customRange: { start: Date; end: Date } | null;
  setCustomRange: (r: { start: Date; end: Date } | null) => void;
  repoIds: number[];
  setRepoIds: (ids: number[]) => void;
  tenureMode: 'global' | 'repo';
  setTenureMode: (m: 'global' | 'repo') => void;
}

export default function FilterBar({
  preset,
  setPreset,
  customRange,
  setCustomRange,
  repoIds,
  setRepoIds,
  tenureMode,
  setTenureMode,
}: FilterBarProps) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);

  const { data: trackedData } = useQuery<{ repos: TrackedRepo[] }>({
    queryKey: ['repos', 'tracked'],
    queryFn: () => fetch('/api/repos').then((r) => r.json()),
  });

  const allRepos = trackedData?.repos ?? [];

  function handleDateRangeSelect(range: DateRange | undefined) {
    if (range?.from && range?.to) {
      setPreset('custom');
      setCustomRange({ start: range.from, end: range.to });
      setDatePickerOpen(false);
    }
  }

  // repoIds=[] means "all repos" to the API. In the UI we show all as checked.
  const allSelected = repoIds.length === 0;
  const effectiveSelected = allSelected ? allRepos.map((r) => r.id) : repoIds;

  function toggleRepo(id: number) {
    if (allSelected) {
      // First uncheck: switch from "all" to "all except this one"
      setRepoIds(allRepos.map((r) => r.id).filter((rid) => rid !== id));
    } else if (effectiveSelected.includes(id)) {
      const next = repoIds.filter((r) => r !== id);
      // If nothing left, go back to "all"
      if (next.length === 0) {
        setRepoIds([]);
      } else {
        setRepoIds(next);
      }
    } else {
      const next = [...repoIds, id];
      // If all are now selected, go back to "all" (empty array)
      if (next.length === allRepos.length) {
        setRepoIds([]);
      } else {
        setRepoIds(next);
      }
    }
  }

  const selectedDateRange: DateRange | undefined =
    preset === 'custom' && customRange
      ? { from: customRange.start, to: customRange.end }
      : undefined;

  return (
    <div className="h-12 border-b flex items-center gap-3 px-6">
      {/* Date preset chips */}
      <div className="flex items-center gap-1">
        {DATE_PRESETS.map(({ label, value }) => (
          <button
            key={value}
            aria-pressed={preset === value}
            onClick={() => {
              setPreset(value);
              setCustomRange(null);
            }}
            className={[
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
              preset === value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:bg-muted',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Custom date range picker */}
      <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
        <PopoverTrigger
          className={[
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
            preset === 'custom'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border text-muted-foreground hover:bg-muted',
          ].join(' ')}
          aria-label="Select custom date range"
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          {preset === 'custom' && customRange
            ? `${customRange.start.toLocaleDateString()} – ${customRange.end.toLocaleDateString()}`
            : 'Custom'}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={selectedDateRange}
            onSelect={handleDateRangeSelect}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>

      {/* Data filters — pushed to the right */}
      <div className="flex items-center gap-3 ml-auto">
        {/* Repo multi-select */}
        <Popover open={repoPickerOpen} onOpenChange={setRepoPickerOpen}>
          <PopoverTrigger
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
            aria-label="Select repositories"
          >
            {allSelected ? (
              'All repos'
            ) : (
              <>
                <Badge variant="secondary" className="h-4 text-[10px]">
                  {repoIds.length}
                </Badge>
                of {allRepos.length} repo{allRepos.length === 1 ? '' : 's'}
              </>
            )}
            <ChevronDownIcon className="h-3 w-3 opacity-60" />
          </PopoverTrigger>
          <PopoverContent className="w-72 bg-popover" align="end">
            <div className="space-y-1">
              {allRepos.map((repo) => {
                const isChecked = effectiveSelected.includes(repo.id);
                return (
                  <button
                    key={repo.id}
                    onClick={() => toggleRepo(repo.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                      isChecked
                        ? 'bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <div className={cn(
                      'h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0',
                      isChecked ? 'bg-primary border-primary' : 'border-border'
                    )}>
                      {isChecked && <CheckIcon className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    <span className="truncate">{repo.fullName}</span>
                  </button>
                );
              })}
            </div>
            {!allSelected && (
              <div className="border-t mt-2 pt-2">
                <button
                  onClick={() => setRepoIds([])}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Select all repos
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Tenure mode toggle */}
        <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1">
          Cohort mode
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="block max-w-sm text-left leading-relaxed bg-popover text-popover-foreground border shadow-md">
                <p><strong>Global:</strong> Tenure is measured from each contributor's first commit across all repos. A senior contributor is senior everywhere.</p>
                <p className="mt-1"><strong>Per-repo:</strong> Tenure resets per repo. A veteran in one repo can be "new" in another they just started contributing to.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
        <Tabs
          value={tenureMode}
          onValueChange={(v) => setTenureMode(v as 'global' | 'repo')}
        >
          <TabsList className="h-7">
            <TabsTrigger value="global" className="text-xs px-2 py-0.5 data-active:bg-primary data-active:text-primary-foreground">
              Global
            </TabsTrigger>
            <TabsTrigger value="repo" className="text-xs px-2 py-0.5 data-active:bg-primary data-active:text-primary-foreground">
              Per-repo
            </TabsTrigger>
          </TabsList>
        </Tabs>
        </div>
      </div>
    </div>
  );
}
