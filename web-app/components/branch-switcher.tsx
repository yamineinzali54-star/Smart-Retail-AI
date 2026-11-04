"use client";

import { useEffect, useState } from "react";

interface BranchOption {
  id: string;
  code: string;
  name: string;
}

export default function BranchSwitcher() {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/branches")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setBranches(data.branches);
          setActiveId(data.activeBranchId);
        }
      })
      .catch(() => undefined);
  }, []);

  // Single accessible branch — show disabled so the control is always visible.
  const single = branches.length <= 1;

  async function switchBranch(branchId: string) {
    if (!branchId || branchId === activeId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/switch-branch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branchId }),
      });
      const data = await res.json();
      if (data.ok) {
        // Full reload: server components + cookies now scope to the new branch.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- switch-branch revokes all sessions; a hard reload is required, router.push would keep stale session state.
        window.location.href = "/dashboard";
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
      <span>Branch</span>
      <select
        value={activeId ?? ""}
        disabled={busy || single}
        onChange={(e) => void switchBranch(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
        aria-label="Active branch"
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code} — {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
