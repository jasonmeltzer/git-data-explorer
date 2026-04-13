import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@shared/components/ui/button.js';
import { Input } from '@shared/components/ui/input.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible.js';
import { toast } from 'sonner';
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

  const updateOrg = useUpdateOrg();

  useEffect(() => {
    setLabel(org.label);
    setSizeCategory(org.sizeCategory ?? '');
  }, [org.label, org.sizeCategory]);

  const handleSave = async () => {
    try {
      await updateOrg.mutateAsync({
        orgId: org.id,
        data: {
          label: label || undefined,
          sizeCategory: sizeCategory || undefined,
        },
      });
      toast.success('Org metadata saved');
      setOpen(false);
    } catch {
      toast.error('Failed to save org metadata');
    }
  };

  const handleDiscard = () => {
    setLabel(org.label);
    setSizeCategory(org.sizeCategory ?? '');
    setOpen(false);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="flex items-center gap-1 text-muted-foreground" />}>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Edit org metadata
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
