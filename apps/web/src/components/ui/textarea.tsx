import * as React from "react"
import { cn } from "@/lib/cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-20 w-full rounded-control border border-border-control bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-ink-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-bad md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
