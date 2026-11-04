"use client"

import * as React from "react"
import { cn } from "cn"
import { localizeNode, useI18n } from "@/lib/i18n"

function Label({ className, children, ...props }: React.ComponentProps<"label">) {
  const { locale } = useI18n()
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-xs leading-none select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {localizeNode(locale, children)}
    </label>
  )
}

export { Label }
