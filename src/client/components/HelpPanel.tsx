import { useState } from 'react';
import type { ReactNode } from 'react';
import { HelpCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@shared/components/ui/collapsible';

export interface HelpPanelProps {
  children: ReactNode;
}

export function HelpPanel({ children }: HelpPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground py-2 transition-colors">
        <HelpCircle className="h-4 w-4" />
        <span>What does this mean?</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 bg-muted/30 rounded-md p-4 text-sm text-muted-foreground leading-relaxed">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
