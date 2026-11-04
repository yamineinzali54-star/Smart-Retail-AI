"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Supplier {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
}

interface Line {
  productId: string;
  quantity: string;
  unitPrice: string;
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [usingLinked, setUsingLinked] = useState(false);
  const [expectedDate, setExpectedDate] = useState(() => {
    const d = new Date(Date.now() + 7 * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "1", unitPrice: "0.00" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadProductsForSupplier = useCallback(async (sid: string) => {
    if (!sid) {
      setProducts(allProducts);
      setUsingLinked(false);
      return;
    }
    try {
      const res = await fetch(`/api/admin/purchase-orders/lookups?supplierId=${sid}`);
      const data = await res.json();
      if (data.ok && data.products.length > 0) {
        setProducts(data.products);
        setUsingLinked(true);
      } else {
        setProducts(allProducts);
        setUsingLinked(false);
      }
    } catch {
      setProducts(allProducts);
      setUsingLinked(false);
    }
  }, [allProducts]);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/suppliers?pageSize=100").then((r) => r.json()),
      fetch("/api/admin/products?pageSize=200").then((r) => r.json()),
    ])
      .then(([s, p]) => {
        const supplierList: Supplier[] = s.ok ? s.suppliers : [];
        const productList: Product[] = p.ok ? p.products : [];
        setSuppliers(supplierList);
        setAllProducts(productList);
        setProducts(productList);
        if (supplierList.length > 0) {
          const firstId = supplierList[0].id;
          setSupplierId(firstId);
          void loadProductsForSupplier(firstId);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSupplierChange(sid: string) {
    setSupplierId(sid);
    void loadProductsForSupplier(sid);
    setLines((ls) =>
      ls.map((l) => ({ ...l, productId: "" })),
    );
  }

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/purchase-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          supplierId,
          expectedDate: new Date(expectedDate).toISOString(),
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: Number(l.quantity),
            unitPrice: l.unitPrice,
          })),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Create failed");
        return;
      }
      router.push(`/purchase-orders/${data.purchaseOrder.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title="New purchase order">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>PO details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="supplier">Supplier</Label>
              <LocalizedSelect
                id="supplier"
                value={supplierId}
                onChange={(e) => handleSupplierChange(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                required
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </LocalizedSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="exp">Expected date</Label>
              <Input id="exp" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} required />
            </div>
            {usingLinked && (
              <p className="text-xs text-muted-foreground">
                Showing products linked to this supplier ({products.length}).
              </p>
            )}
            {!usingLinked && supplierId && (
              <p className="text-xs text-muted-foreground">
                No linked products — showing all products.
              </p>
            )}
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-3 gap-2 rounded-md border p-2">
                <LocalizedSelect
                  value={l.productId}
                  onChange={(e) => setLine(i, { productId: e.target.value })}
                  className="rounded-md border border-input bg-background px-2 py-2 text-sm"
                  required
                >
                  <option value="">— select —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </LocalizedSelect>
                <Input placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} inputMode="numeric" required />
                <Input placeholder="Unit price" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} required pattern="^\d+(\.\d{1,2})?$" />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => setLines((ls) => [...ls, { productId: "", quantity: "1", unitPrice: "0.00" }])}
            >
              Add line
            </Button>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create PO"}</Button>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}
