import { useState, useMemo } from 'react';
import { subDays, subMonths, startOfDay } from 'date-fns';

export type DatePreset = '30d' | '90d' | '6mo' | '1yr' | 'all' | 'custom';

export interface DashboardFilters {
  preset: DatePreset;
  startDate: string;
  endDate: string;
  repoIds: number[];
  tenureMode: 'global' | 'repo';
  rollingGranularity: 'month' | 'quarter';
}

export function useDashboardFilters() {
  const [preset, setPreset] = useState<DatePreset>('90d');
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);
  const [repoIds, setRepoIds] = useState<number[]>([]);
  const [tenureMode, setTenureMode] = useState<'global' | 'repo'>('global');
  const [rollingGranularity, setRollingGranularity] = useState<'month' | 'quarter'>('month');

  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    const end = startOfDay(now).toISOString();
    if (preset === 'custom' && customRange) {
      return { startDate: customRange.start.toISOString(), endDate: customRange.end.toISOString() };
    }
    const map: Record<Exclude<DatePreset, 'custom'>, string> = {
      '30d': subDays(now, 30).toISOString(),
      '90d': subDays(now, 90).toISOString(),
      '6mo': subMonths(now, 6).toISOString(),
      '1yr': subMonths(now, 12).toISOString(),
      'all': new Date(0).toISOString(),
    };
    return { startDate: map[preset as Exclude<DatePreset, 'custom'>], endDate: end };
  }, [preset, customRange]);

  return {
    preset, setPreset, customRange, setCustomRange,
    startDate, endDate, repoIds, setRepoIds,
    tenureMode, setTenureMode, rollingGranularity, setRollingGranularity,
  };
}
