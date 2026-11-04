"use client"

import * as React from "react"
import { useTheme } from "@/components/theme-provider"
import { RiSunLine, RiMoonLine, RiComputerLine, RiCheckLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const OPTIONS = [
  { value: "light", label: "Light", icon: <RiSunLine /> },
  { value: "dark", label: "Dark", icon: <RiMoonLine /> },
  { value: "system", label: "System", icon: <RiComputerLine /> },
] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    void Promise.resolve().then(() => setMounted(true))
  }, [])

  const active = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Theme" />}
      >
        {mounted ? active.icon : <RiComputerLine />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setTheme(option.value)}
          >
            {option.icon}
            <span>{option.label}</span>
            {mounted && theme === option.value && (
              <RiCheckLine className="ml-auto" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
