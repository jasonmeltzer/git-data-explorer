import type { AggregationMode } from '../hooks/useAggregation.js';

interface AggregationToggleProps {
  mode: AggregationMode;
  onChange: (mode: AggregationMode) => void;
}

export default function AggregationToggle({ mode, onChange }: AggregationToggleProps) {
  return (
    <div className="space-y-2">
      <fieldset>
        <legend className="text-sm font-medium mb-2">Aggregation mode</legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="aggregation-mode"
              value="weighted"
              checked={mode === 'weighted'}
              onChange={() => onChange('weighted')}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm">Weighted by contributor count</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="aggregation-mode"
              value="normalized"
              checked={mode === 'normalized'}
              onChange={() => onChange('normalized')}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm">Equal weight per org</span>
          </label>
        </div>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Weighted: large orgs count more. Equal: each org counts once regardless of size.
      </p>
    </div>
  );
}
