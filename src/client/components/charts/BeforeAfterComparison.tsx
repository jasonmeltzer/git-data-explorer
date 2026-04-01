import { useBeforeAfter } from '../../hooks/useBeforeAfter.js';
import { SectionHeader } from '../SectionHeader.js';
import { HelpPanel } from '../HelpPanel.js';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Badge } from '@shared/components/ui/badge.js';

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

function formatNum(n: number): string {
  return Math.round(n).toLocaleString();
}

function pctDelta(before: number, after: number): { str: string; positive: boolean } {
  if (before === 0) return { str: 'N/A', positive: true };
  const pct = ((after - before) / before) * 100;
  const rounded = Math.round(pct);
  return {
    str: rounded >= 0 ? `+${rounded}%` : `${rounded}%`,
    positive: pct >= 0,
  };
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
  const rampUpDelta = pctDelta(data.before.rampUpSpeed, data.after.rampUpSpeed);
  const contributorsDelta = pctDelta(data.before.activeContributors, data.after.activeContributors);

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
              label="Avg Commit Size"
              beforeValue={formatNum(data.before.avgCommitSize)}
              afterValue={formatNum(data.after.avgCommitSize)}
              deltaStr={commitSizeDelta.str}
              deltaPositive={commitSizeDelta.positive}
            />
            <MetricRow
              label="PR Frequency"
              beforeValue={formatNum(data.before.prFrequency)}
              afterValue={formatNum(data.after.prFrequency)}
              deltaStr={prFreqDelta.str}
              deltaPositive={prFreqDelta.positive}
            />
            <MetricRow
              label="Ramp-Up Speed"
              beforeValue={formatNum(data.before.rampUpSpeed)}
              afterValue={formatNum(data.after.rampUpSpeed)}
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
          The AI marker date is the date your team began using an AI coding tool (e.g. GitHub Copilot, Cursor, Claude). All metrics in this section are split at that date to show how contribution patterns changed. You can set or change the AI marker date on the Settings page. The comparison is most meaningful when you have at least 3 months of data on each side of the marker.
        </HelpPanel>
      </div>
    </section>
  );
}
