"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const tabs = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/password", label: "Password" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/language", label: "Language" },
  { href: "/settings/security", label: "Security" },
]

export function SettingsTabs() {
  const pathname = usePathname()

  return (
    <nav aria-label="Settings sections" className="flex w-full gap-1 overflow-x-auto border-b border-border pb-px">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground"
                : "border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            }
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
