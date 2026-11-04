"use client";

import { use, useEffect, useState } from "react";

interface DisplayState {
  branchName: string;
  saleNumber: string | null;
  grandTotal: string | null;
  itemCount: number | null;
  saleDate: string | null;
}

// Customer-facing display — public, polls the latest completed sale.
// Mount on a second screen at /display/{branchCode}.
export default function CustomerDisplayPage({
  params,
}: {
  params: Promise<{ branchCode: string }>;
}) {
  const { branchCode } = use(params);
  const [state, setState] = useState<DisplayState | null>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`/api/public/display/${encodeURIComponent(branchCode)}`);
        const data = await res.json();
        if (alive && data.ok) setState(data.display);
      } catch {
        // Offline — keep the last rendered total on screen.
      }
    }
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [branchCode]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-primary p-8 text-center text-primary-foreground">
      <p className="text-xl tracking-wide text-muted-foreground">
        {state?.branchName ?? branchCode.toUpperCase()}
      </p>
      {state?.grandTotal ? (
        <>
          <p className="mt-4 text-7xl font-bold tabular-nums">{state.grandTotal}</p>
          <p className="mt-3 text-lg text-muted-foreground">
            {state.itemCount ?? 0} items · {state.saleNumber}
          </p>
          {state.saleDate && (
          <p className="mt-1 text-sm text-muted-foreground">
              {new Date(state.saleDate).toLocaleTimeString()}
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 text-3xl text-muted-foreground">Welcome — thank you for shopping</p>
      )}
    </main>
  );
}
