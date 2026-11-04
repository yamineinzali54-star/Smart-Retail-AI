"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Counter {
  id: string;
  name: string;
  location: string | null;
  inUse: boolean;
}

export default function SelectCounterPage() {
  const router = useRouter();
  const [counters, setCounters] = useState<Counter[]>([]);
  const [openingCash, setOpeningCash] = useState("0.00");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pos-sessions/select")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        if (data.restored) {
          router.push("/pos/terminal");
          return;
        }
        setCounters(data.counters);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [router]);

  async function open(counterId: string) {
    setError(null);
    const res = await fetch("/api/pos-sessions/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ counterId, openingCash }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || "Open failed");
      return;
    }
    router.push("/pos/terminal");
  }

  return (
    <PageShell title="Select counter" subtitle="One cashier, one counter, one active session">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Open a session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cash">Opening cash</Label>
            <Input id="cash" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} required pattern="^\d+(\.\d{1,2})?$" />
          </div>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {counters.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-muted-foreground">{c.location ?? ""}</p>
              </div>
              {c.inUse ? (
                <Badge variant="secondary">in use</Badge>
              ) : (
                <Button size="sm" onClick={() => void open(c.id)}>Open</Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </PageShell>
  );
}
