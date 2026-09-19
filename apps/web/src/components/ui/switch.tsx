"use client"

import * as React from "react"
import { cn } from "@/lib/cn"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent",
        // `surface-2` sits a hair off white, so an off switch would read as a
        // disabled one. `border-control` is the token that already carries
        // "an unfilled control lives here".
        "bg-border-control data-[state=checked]:bg-primary",
        "transition-colors duration-(--dur-fast) ease-(--ease-out)",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-surface shadow-(--shadow-sm) ring-0",
          "translate-x-0.5 data-[state=checked]:translate-x-[1.125rem]",
          "transition-transform duration-(--dur-fast) ease-(--ease-out)",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
