"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PosSession {
  id: string;
  openingCash: string;
}

export default function EndSessionPage() {
  const router = useRouter();
  const [session, setSession] = useState<PosSession | null>(null);
  const [actual, setActual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pos-sessions/current")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "No active session");
        setSession(data.session);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function close(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setError(null);
    const res = await fetch(`/api/pos-sessions/${session.id}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actualClosingCash: actual }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || "Close failed");
      return;
    }
    router.push("/pos/today-sales");
  }

  return (
    <PageShell title="End session" subtitle="Count the till — discrepancies over threshold alert Admin">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Cash reconciliation</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {session && (
            <form onSubmit={close} className="space-y-3">
              <p className="text-sm text-muted-foreground">Opening cash: {session.openingCash}</p>
              <div className="space-y-1">
                <Label htmlFor="actual">Actual closing cash (counted)</Label>
                <Input id="actual" value={actual} onChange={(e) => setActual(e.target.value)} required pattern="^\d+(\.\d{1,2})?$" />
              </div>
              <Button type="submit">Close session</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
