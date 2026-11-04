"use client"

import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"
import { translateDisplayText, useI18n } from "@/lib/i18n"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const { locale } = useI18n()
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-none border border-input bg-background px-3 py-1.5 text-xs transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-xs dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
      placeholder={props.placeholder ? translateDisplayText(locale, props.placeholder) : props.placeholder}
      aria-label={props["aria-label"] ? translateDisplayText(locale, props["aria-label"]) : props["aria-label"]}
    />
  )
}

export { Input }
