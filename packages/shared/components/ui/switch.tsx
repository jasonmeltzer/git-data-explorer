"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@shared/lib/utils"

function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props) {
  const checked = props.checked === true;

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex shrink-0 items-center outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        backgroundColor: checked ? '#2563eb' : '#d1d5db',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
        padding: '2px',
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full ring-0"
        style={{
          width: '20px',
          height: '20px',
          backgroundColor: '#fff',
          borderRadius: '10px',
          transition: 'transform 0.2s',
          transform: checked ? 'translateX(20px)' : 'translateX(0)',
        }}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
