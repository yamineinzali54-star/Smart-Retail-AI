"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { isNavActive } from "@/lib/nav-active"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavMain({
  items,
  sections,
}: {
  items?: {
    title: string
    url: string
    icon?: React.ReactNode
  }[]
  sections?: {
    label: string
    items: {
      title: string
      url: string
      icon?: React.ReactNode
    }[]
  }[]
}) {
  const pathname = usePathname()
  const groups = sections ?? [{ label: "", items: items ?? [] }]

  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.label || "main"}>
          {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
          <SidebarGroupContent className="flex flex-col gap-1">
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={isNavActive(pathname, item.url)}
                    render={<Link href={item.url} />}
                  >
                    {item.icon}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}
