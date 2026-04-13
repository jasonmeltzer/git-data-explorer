import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@shared/components/ui/button.js';
import { Input } from '@shared/components/ui/input.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible.js';
import { useUpdateOrg } from '../hooks/useOrgs.js';
import type { OrgDetail } from '../hooks/useOrgs.js';

interface OrgMetadataFormProps {
  org: OrgDetail;
}

const SIZE_OPTIONS = [
  { value: '', label: 'Select size...' },
  { value: 'small', label: 'Small (5-15 devs)' },
  { value: 'medium', label: 'Medium (50-150 devs)' },
  { value: 'large', label: 'Large (150+ devs)' },
];

export default function OrgMetadataForm({ org }: OrgMetadataFormProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(org.label);
  const [sizeCategory, setSizeCategory] = useState(org.sizeCategory ?? '');
  const [industry, setIndustry] = useState(org.industry ?? '');
  const [aiTool, setAiTool] = useState(org.aiTool ?? '');

  const updateOrg = useUpdateOrg();

  const handleSave = async () => {
    await updateOrg.mutateAsync({
      orgId: org.id,
      data: {
        label: label || undefined,
        sizeCategory: sizeCategory || undefined,
        industry: industry || undefined,
        aiTool: aiTool || undefined,
      },
    });
    setOpen(false);
  };

  const handleDiscard = () => {
    setLabel(org.label);
    setSizeCategory(org.sizeCategory ?? '');
    setIndustry(org.industry ?? '');
    setAiTool(org.aiTool ?? '');
    setOpen(false);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="flex items-center gap-1 text-muted-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Edit org metadata
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 p-4 rounded-lg border bg-muted/30">
          <div className="space-y-1">
            <label htmlFor="org-label" className="text-xs text-muted-foreground">Label</label>
            <Input
              id="org-label"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Org name"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="org-size" className="text-xs text-muted-foreground">Size Category</label>
            <select
              id="org-size"
              value={sizeCategory}
              onChange={e => setSizeCategory(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {SIZE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="org-industry" className="text-xs text-muted-foreground">Industry</label>
            <Input
              id="org-industry"
              value={industry}
              onChange={e => setIndustry(e.target.value)}
              placeholder="e.g. SaaS, Fintech"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="org-ai-tool" className="text-xs text-muted-foreground">AI Tool</label>
            <Input
              id="org-ai-tool"
              value={aiTool}
              onChange={e => setAiTool(e.target.value)}
              placeholder="e.g. GitHub Copilot"
            />
          </div>
          <div className="col-span-full flex gap-2 pt-1">
            <Button
              onClick={handleSave}
              disabled={updateOrg.isPending}
            >
              Save changes
            </Button>
            <Button variant="outline" onClick={handleDiscard} disabled={updateOrg.isPending}>
              Discard changes
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
