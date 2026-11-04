"use client"

import { useRouter } from "next/navigation"
import type { ReactNode } from "react"

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"

export function RouteDialog({ children }: { children: ReactNode }) {
  const router = useRouter()

  return (
    <Dialog open onOpenChange={(open) => { if (!open) router.back() }}>
      <DialogContent
        data-route-dialog="true"
        className="max-h-[calc(100vh-1.5rem)] max-w-6xl overflow-y-auto p-0 sm:max-h-[calc(100vh-3rem)]"
      >
        <DialogTitle className="sr-only">Create or update record</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}
