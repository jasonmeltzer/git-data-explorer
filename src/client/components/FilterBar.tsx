import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar } from '@shared/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shared/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@shared/components/ui/command';
import { Badge } from '@shared/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import type { DatePreset } from '../hooks/useDashboardFilters';
import type { TrackedRepo } from '@shared/types.js';
import { CalendarIcon, CheckIcon, ChevronDownIcon } from 'lucide-react';
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

  function toggleRepo(id: number) {
    if (repoIds.includes(id)) {
      setRepoIds(repoIds.filter((r) => r !== id));
    } else {
      setRepoIds([...repoIds, id]);
    }
  }

  const selectedDateRange: DateRange | undefined =
    preset === 'custom' && customRange
      ? { from: customRange.start, to: customRange.end }
      : undefined;

  const repoLabel =
    repoIds.length === 0
      ? 'All repos'
      : `${repoIds.length} repos selected`;

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

      {/* Repo multi-select */}
      <Popover open={repoPickerOpen} onOpenChange={setRepoPickerOpen}>
        <PopoverTrigger
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
          aria-label="Select repositories"
        >
          {repoIds.length > 0 ? (
            <>
              <Badge variant="secondary" className="h-4 text-[10px]">
                {repoIds.length}
              </Badge>
              repos selected
            </>
          ) : (
            'All repos'
          )}
          <ChevronDownIcon className="h-3 w-3 opacity-60" />
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search repos..." />
            <CommandList>
              <CommandEmpty>No repos found.</CommandEmpty>
              <CommandGroup>
                {allRepos.map((repo) => {
                  const isSelected = repoIds.includes(repo.id);
                  return (
                    <CommandItem
                      key={repo.id}
                      onSelect={() => toggleRepo(repo.id)}
                      data-checked={isSelected}
                    >
                      <span className="flex-1 truncate">{repo.fullName}</span>
                      {isSelected && <CheckIcon className="h-4 w-4 ml-2 shrink-0" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
          {repoIds.length > 0 && (
            <div className="border-t p-2">
              <button
                onClick={() => setRepoIds([])}
                className="text-xs text-muted-foreground hover:text-foreground w-full text-left"
              >
                Clear selection (show all repos)
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Tenure mode toggle */}
      <div className="flex items-center gap-2 ml-auto">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Cohort mode</span>
        <Tabs
          value={tenureMode}
          onValueChange={(v) => setTenureMode(v as 'global' | 'repo')}
        >
          <TabsList className="h-7">
            <TabsTrigger value="global" className="text-xs px-2 py-0.5">
              Global
            </TabsTrigger>
            <TabsTrigger value="repo" className="text-xs px-2 py-0.5">
              Per-repo
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
