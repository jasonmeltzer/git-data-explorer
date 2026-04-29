import { useState } from 'react';
import type { ReactNode } from 'react';
import { HelpCircle, ChevronDown, ChevronRight } from 'lucide-react';

export interface HelpPanelProps {
  children: ReactNode;
  /**
   * Phase 9.5 (D-11): When true, the panel is open on first render.
   * Existing call sites omit this prop and keep the original closed-by-default behavior.
   */
  defaultOpen?: boolean;
}

export function HelpPanel({ children, defaultOpen = false }: HelpPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground py-2 transition-colors"
      >
        <HelpCircle className="h-4 w-4" />
        <span>What does this mean?</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="mt-2 bg-muted/30 rounded-md p-4 text-sm text-muted-foreground leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}
