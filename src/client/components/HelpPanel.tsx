import { useState } from 'react';
import type { ReactNode } from 'react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@shared/components/ui/collapsible';

export interface HelpPanelProps {
  children: ReactNode;
}

export function HelpPanel({ children }: HelpPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline py-2">
        {open ? 'What does this mean? v' : 'What does this mean? >'}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 bg-muted/30 rounded-md p-4 text-sm text-muted-foreground leading-relaxed">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
