import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@shared/lib/utils"
import { CheckIcon, MinusIcon } from "lucide-react"

const baseStyle: React.CSSProperties = {
  display: 'inline-flex',
  width: '20px',
  height: '20px',
  minWidth: '20px',
  minHeight: '20px',
  border: '2px solid #888',
  boxSizing: 'border-box',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '4px',
  flexShrink: 0,
  cursor: 'pointer',
  transition: 'background-color 0.15s, border-color 0.15s',
}

const checkedStyle: React.CSSProperties = {
  ...baseStyle,
  backgroundColor: '#2563eb',
  borderColor: '#2563eb',
  color: '#fff',
}

const indeterminateStyle: React.CSSProperties = {
  ...baseStyle,
  backgroundColor: '#2563eb',
  borderColor: '#2563eb',
  color: '#fff',
}

function Checkbox({ className, style, ...props }: CheckboxPrimitive.Root.Props & { style?: React.CSSProperties; 'data-state'?: string }) {
  const dataState = props['data-state'];
  const isIndeterminate = dataState === 'indeterminate';
  const checked = props.checked === true;

  const currentStyle = isIndeterminate ? indeterminateStyle : checked ? checkedStyle : baseStyle;

  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-3 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      style={{
        ...currentStyle,
        ...style,
      }}
      {...props}
    >
      {isIndeterminate ? (
        <span className="grid place-content-center text-current [&>svg]:size-3.5">
          <MinusIcon />
        </span>
      ) : (
        <CheckboxPrimitive.Indicator
          data-slot="checkbox-indicator"
          className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
        >
          <CheckIcon />
        </CheckboxPrimitive.Indicator>
      )}
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
