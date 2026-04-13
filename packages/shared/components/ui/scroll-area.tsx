import * as React from "react"
import { cn } from "@shared/lib/utils"

/**
 * Minimal ScrollArea component — uses native overflow-y-auto.
 * Matches the shadcn/ui ScrollArea API surface needed by research tool.
 */
function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="scroll-area"
      className={cn("overflow-y-auto", className)}
      {...props}
    >
      {children}
    </div>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" }) {
  return (
    <div
      data-slot="scroll-bar"
      data-orientation={orientation}
      className={cn(
        "flex touch-none select-none transition-colors",
        orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent p-[1px]",
        orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent p-[1px]",
        className
      )}
      {...props}
    />
  )
}

export { ScrollArea, ScrollBar }
