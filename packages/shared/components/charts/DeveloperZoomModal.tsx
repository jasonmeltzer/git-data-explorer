import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog.js';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs.js';
import {
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@shared/components/ui/chart.js';
import { DEVELOPER_METRIC_OPTIONS } from '@shared/lib/narratives.js';
import type { DeveloperMetricOption } from '@shared/lib/narratives.js';
import type { DeveloperMonthlyRow } from '@shared/types.js';

/**
 * Phase 9.5 (D-05): Click-to-zoom modal for any DeveloperMiniChart.
 *
 * Renders a larger view of the selected dev's monthly trajectory plus a
 * cohort 25th-75th percentile band (computed by the parent and passed in)
 * and all 4 metric tabs.
 *
 * Privacy invariant (ADR-2): no name-reveal toggle, no link to per-developer
 * detail routes, no raw-HTML rendering. authorLogin is always rendered via JSX
 * text nodes (auto-escaped by React).
 */

interface DeveloperZoomModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authorLogin: string;
  rows: DeveloperMonthlyRow[];
  cohortMeanByMonth: Map<string, number | null>;
  cohortBandByMonth: Map<string, { p25: number | null; p75: number | null }>;
  aiMarkerMonth: string | null;
  initialMetric?: DeveloperMetricOption;
}

export function DeveloperZoomModal({
  open,
  onOpenChange,
  authorLogin,
  rows,
  cohortMeanByMonth,
  cohortBandByMonth,
  aiMarkerMonth,
  initialMetric = 'prCount',
}: DeveloperZoomModalProps) {
  const [metric, setMetric] = useState<DeveloperMetricOption>(initialMetric);

  // Reset to initialMetric whenever the modal opens for a different dev.
  useEffect(() => {
    if (open) setMetric(initialMetric);
  }, [open, initialMetric, authorLogin]);

  const data = rows.map(r => {
    const band = cohortBandByMonth.get(r.month);
    return {
      month: r.month,
      value: getMetricValue(r, metric),
      cohortMean: cohortMeanByMonth.get(r.month) ?? null,
      p25: band?.p25 ?? null,
      p75: band?.p75 ?? null,
    };
  });

  const chartConfig = {
    value: { label: metric, color: 'var(--chart-1)' },
    cohortMean: { label: 'Cohort mean', color: 'var(--muted-foreground)' },
    p25: { label: 'Cohort p25', color: 'var(--muted)' },
    p75: { label: 'Cohort p75', color: 'var(--muted)' },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{authorLogin} — Trajectory</DialogTitle>
        </DialogHeader>

        <Tabs value={metric} onValueChange={(v) => setMetric(v as DeveloperMetricOption)}>
          <TabsList className="h-8 gap-1">
            {DEVELOPER_METRIC_OPTIONS.map(opt => (
              <TabsTrigger
                key={opt.value}
                value={opt.value}
                className="text-xs px-3 py-1 data-active:bg-primary data-active:text-primary-foreground"
              >
                {opt.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/*
          Render the chart ONCE outside the Tabs panels. The previous
          implementation looped 4 TabsContent panels each rendering an
          identical ComposedChart; base-ui keeps non-active panels mounted at
          zero width, so Recharts measured stale dimensions and bars
          animated from those bad positions ("flying off-screen" on first
          open). Single chart instance keyed on `metric` dodges the issue.
          isAnimationActive=false on Bar/Line is belt-and-suspenders against
          any residual measurement-during-Dialog-enter glitches.
        */}
        <ChartContainer config={chartConfig} className="h-[400px] w-full">
          <ComposedChart data={data}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="month" fontSize={11} />
            <YAxis fontSize={11} />
            <ChartTooltip content={<ChartTooltipContent />} />

            {/* Cohort 25-75 percentile band (D-05) — render BEHIND bars */}
            <Area
              type="monotone"
              dataKey="p75"
              stroke="none"
              fill="var(--muted)"
              fillOpacity={0.15}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="p25"
              stroke="none"
              fill="var(--background)"
              fillOpacity={1}
              connectNulls={false}
              isAnimationActive={false}
            />

            <Bar
              dataKey="value"
              fill="var(--chart-1)"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />

            <Line
              type="monotone"
              dataKey="cohortMean"
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />

            {aiMarkerMonth && (
              <ReferenceLine
                x={aiMarkerMonth}
                stroke="var(--chart-ai-marker)"
                strokeDasharray="4 4"
                strokeWidth={2}
                label={({ viewBox }) => {
                  if (!viewBox || typeof (viewBox as { x?: number }).x !== 'number') return null;
                  const { x: cx } = viewBox as { x: number };
                  return (
                    <text x={cx + 4} y={16} fontSize={11} fill="var(--muted-foreground)">
                      AI tools adopted
                    </text>
                  );
                }}
              />
            )}
          </ComposedChart>
        </ChartContainer>

        <p className="text-xs text-muted-foreground mt-2">
          Shaded band shows the 25th-75th percentile of contributors at the same tenure cohort. Dashed line shows cohort mean.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function getMetricValue(row: DeveloperMonthlyRow, metric: DeveloperMetricOption): number | null {
  switch (metric) {
    case 'prCount': return row.prCount;
    case 'commitCount': return row.commitCount;
    case 'linesPerCommit': return row.meanLinesPerCommit;
    case 'filesPerCommit': return row.meanFilesPerCommit;
  }
}
