import { useBeforeAfter } from '../../hooks/useBeforeAfter.js';
import { SectionHeader } from '../SectionHeader.js';
import { HelpPanel } from '../HelpPanel.js';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Badge } from '@shared/components/ui/badge.js';
import { pctDelta, formatNum } from '../../lib/deltaFormat.js';

interface BeforeAfterComparisonProps {
  repoIds: number[];
  aiMarkerDate: string | null;
}

interface MetricRowProps {
  label: string;
  beforeValue: string;
  afterValue: string;
  deltaStr: string;
  deltaPositive: boolean;
}

function MetricRow({ label, beforeValue, afterValue, deltaStr, deltaPositive }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm tabular-nums w-16 text-right">{beforeValue}</span>
        <span className="text-sm tabular-nums w-16 text-right font-medium">{afterValue}</span>
        <Badge
          variant="outline"
          className={`text-xs w-16 justify-center ${deltaPositive ? 'text-emerald-500 border-emerald-200' : 'text-red-500 border-red-200'}`}
        >
          {deltaStr}
        </Badge>
      </div>
    </div>
  );
}


export function BeforeAfterComparison({ repoIds, aiMarkerDate }: BeforeAfterComparisonProps) {
  const { data, isFetching } = useBeforeAfter({ repoIds });

  if (!aiMarkerDate) {
    return (
      <section>
        <SectionHeader title="Before/After AI Adoption" scope="filtered" />
        <Card className="mt-4">
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              Set an AI adoption marker date in Settings to compare before and after metrics.{' '}
              <a href="#/settings" className="text-primary hover:underline">
                Go to Settings
              </a>
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (isFetching && !data) {
    return (
      <section>
        <SectionHeader title="Before/After AI Adoption" scope="filtered" />
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="animate-pulse">
            <CardContent className="p-6 h-48" />
          </Card>
          <Card className="animate-pulse">
            <CardContent className="p-6 h-48" />
          </Card>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section>
        <SectionHeader title="Before/After AI Adoption" scope="filtered" />
        <Card className="mt-4">
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              Not enough data to calculate before/after comparison. Collect more data or adjust your date range.
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  const commitSizeDelta = pctDelta(data.before.avgCommitSize, data.after.avgCommitSize);
  const prFreqDelta = pctDelta(data.before.prFrequency, data.after.prFrequency);
  const rampUpDelta = data.before.rampUpSpeed != null && data.after.rampUpSpeed != null
    ? pctDelta(data.before.rampUpSpeed, data.after.rampUpSpeed, true)
    : { str: 'N/A', positive: true };
  const contributorsDelta = pctDelta(data.before.activeContributors, data.after.activeContributors);

  const formatRampUp = (v: number | null) => v == null ? '—' : formatNum(v);

  return (
    <section>
      <SectionHeader title="Before/After AI Adoption" scope="filtered" />
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Impact of AI Adoption</CardTitle>
          <p className="text-xs text-muted-foreground">AI marker date: {aiMarkerDate}</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            <div className="flex justify-between text-xs text-muted-foreground pb-2 border-b">
              <span>Metric</span>
              <div className="flex gap-3">
                <span className="w-16 text-right">Before</span>
                <span className="w-16 text-right">After</span>
                <span className="w-16 text-right">Change</span>
              </div>
            </div>
            <MetricRow
              label="Avg Commit Size (lines)"
              beforeValue={formatNum(data.before.avgCommitSize)}
              afterValue={formatNum(data.after.avgCommitSize)}
              deltaStr={commitSizeDelta.str}
              deltaPositive={commitSizeDelta.positive}
            />
            <MetricRow
              label="PRs / week / contributor"
              beforeValue={formatNum(data.before.prFrequency)}
              afterValue={formatNum(data.after.prFrequency)}
              deltaStr={prFreqDelta.str}
              deltaPositive={prFreqDelta.positive}
            />
            <MetricRow
              label="New dev ramp-up (weeks)"
              beforeValue={formatRampUp(data.before.rampUpSpeed)}
              afterValue={formatRampUp(data.after.rampUpSpeed)}
              deltaStr={rampUpDelta.str}
              deltaPositive={rampUpDelta.positive}
            />
            <MetricRow
              label="Active Contributors"
              beforeValue={formatNum(data.before.activeContributors)}
              afterValue={formatNum(data.after.activeContributors)}
              deltaStr={contributorsDelta.str}
              deltaPositive={contributorsDelta.positive}
            />
          </div>
        </CardContent>
      </Card>
      <div className="mt-4">
        <HelpPanel>
          <p>
            This view compares contribution patterns from before and after the AI adoption
            date you set in Settings. The left column shows averages from before the date;
            the right column shows averages from after it. The change column shows the
            absolute and percentage shift.
          </p>
          <p className="mt-2">
            Green values mean the metric increased; red means it decreased. For metrics
            where a decrease is a positive signal — such as PR turnaround time or ramp-up
            weeks — the color polarity is inverted so that improvement always shows green.
          </p>
          <p className="mt-2">
            If you have not set an AI adoption date, this view will not show comparisons.
            Go to{' '}
            <a href="#/settings" className="underline hover:text-foreground">Settings &gt; AI Adoption Date</a>{' '}
            to configure it.
          </p>
          <p className="mt-2">
            Use this view to make a concrete case for the impact of AI tooling:
            "After AI adoption, new developers were opening PRs twice as large within
            their first month" is the kind of finding this view is designed to surface.
            Consider pairing this with the Cohort Trends chart to see whether the shift
            is concentrated in newer contributors or org-wide.
          </p>
          <p className="mt-2">
            This view shows how contribution patterns shifted across your team — not individual performance scores.
          </p>
        </HelpPanel>
      </div>
    </section>
  );
}
