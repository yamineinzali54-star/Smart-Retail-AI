"use client";

import { use, useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Batch {
  id: string;
  barcode: string;
  productName: string | null;
  sellingPrice: string;
  expiryDate: string | null;
}

function BarcodeSvg({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) {
      try {
        JsBarcode(ref.current, value, {
          format: "CODE128",
          width: 1.5,
          height: 44,
          displayValue: false,
          margin: 0,
        });
      } catch {
        // Non-encodable value — the text fallback below still shows.
      }
    }
  }, [value]);
  return <svg ref={ref} className="h-12 w-full" role="img" aria-label={value} />;
}

// Barcode shelf labels — on-screen template preview.
export default function BarcodeLabelsPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [copies, setCopies] = useState("4");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/stock/${itemId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setBatch(data.item);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [itemId]);

  const n = Math.min(24, Math.max(1, Number(copies) || 1));

  return (
    <PageShell title="Barcode labels" subtitle="Shelf-label template preview">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {batch && (
        <div className="max-w-2xl space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Label options</CardTitle>
            </CardHeader>
            <CardContent className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="copies">Copies (max 24)</Label>
                <Input id="copies" value={copies} onChange={(e) => setCopies(e.target.value)} inputMode="numeric" className="max-w-24" />
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: n }).map((_, i) => (
              <div key={i} className="rounded-md border bg-white p-2 text-center">
                <p className="truncate text-xs font-medium text-black">{batch.productName ?? "—"}</p>
                <BarcodeSvg value={batch.barcode} />
                <p className="font-mono text-[10px] text-black">{batch.barcode}</p>
                <p className="text-xs font-bold text-black">
                  {batch.sellingPrice}
                  {batch.expiryDate ? ` · exp ${new Date(batch.expiryDate).toLocaleDateString()}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
