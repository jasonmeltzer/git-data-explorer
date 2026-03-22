import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@shared/lib/utils"
import { CheckIcon } from "lucide-react"

function Checkbox({ className, style, ...props }: CheckboxPrimitive.Root.Props & { style?: React.CSSProperties }) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-white transition-colors outline-none group-has-disabled/field:opacity-50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary data-checked:text-primary-foreground",
        className
      )}
      style={{
        border: '2px solid #9ca3af',
        ...style,
      }}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
