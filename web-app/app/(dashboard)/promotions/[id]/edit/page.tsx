"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { use, useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Product {
  id: string;
  name: string;
}

interface LinkedProduct {
  productId: string;
  productName: string | null;
  requiredQuantity: number;
}

interface Promotion {
  id: string;
  name: string;
  type: string;
  value: string;
  startDate: string;
  endDate: string;
  status: string;
  products: LinkedProduct[];
}

export default function EditPromotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [products, setProducts] = useState<Product[]>([]);
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [type, setType] = useState("percentage");
  const [value, setValue] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState("draft");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/products?pageSize=200").then((r) => r.json()),
      fetch(`/api/admin/promotions/${id}`).then((r) => r.json()),
    ])
      .then(([pRes, promoRes]) => {
        if (pRes.ok) setProducts(pRes.products);
        if (promoRes.ok) {
          setPromotion(promoRes.promotion);
          setName(promoRes.promotion.name);
          setType(promoRes.promotion.type);
          setValue(promoRes.promotion.value);
          setStartDate(promoRes.promotion.startDate.slice(0, 10));
          setEndDate(promoRes.promotion.endDate.slice(0, 10));
          setStatus(promoRes.promotion.status);
          const selected: Record<string, number> = {};
          for (const p of promoRes.promotion.products) {
            selected[p.productId] = p.requiredQuantity;
          }
          setSelectedProducts(selected);
        }
      })
      .catch(() => undefined);
  }, [id]);

  function toggleProduct(productId: string) {
    setSelectedProducts((prev) => {
      const next = { ...prev };
      if (next[productId]) {
        delete next[productId];
      } else {
        next[productId] = 1;
      }
      return next;
    });
  }

  function setQuantity(productId: string, qty: number) {
    setSelectedProducts((prev) => {
      if (qty <= 0) {
        const next = { ...prev };
        delete next[productId];
        return next;
      }
      return { ...prev, [productId]: qty };
    });
  }

  async function update(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const productIds = Object.keys(selectedProducts);
      if (productIds.length === 0) {
        setError("Select at least one product");
        return;
      }
      if (type === "bundle" && productIds.length < 2) {
        setError("Bundle promotions require at least 2 products");
        return;
      }
      const requiredQuantities = productIds.map((id) => selectedProducts[id] || 1);
      const res = await fetch(`/api/admin/promotions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          type,
          value,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          status,
          productIds,
          requiredQuantities,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Update failed");
        return;
      }
      setMessage("Promotion updated");
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    const res = await fetch(`/api/admin/promotions/${id}`);
    const data = await res.json();
    if (data.ok) {
      setPromotion(data.promotion);
      const selected: Record<string, number> = {};
      for (const p of data.promotion.products) {
        selected[p.productId] = p.requiredQuantity;
      }
      setSelectedProducts(selected);
    }
  }

  async function activate() {
    const res = await fetch(`/api/admin/promotions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    const data = await res.json();
    if (!data.ok) setMessage(data.error || "Activate failed");
    else void load();
  }

  async function deactivate() {
    const res = await fetch(`/api/admin/promotions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "deactivated" }),
    });
    const data = await res.json();
    if (!data.ok) setMessage(data.error || "Deactivate failed");
    else void load();
  }

  return (
    <PageShell title={promotion ? promotion.name : "Edit Promotion"}>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Edit Promotion</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={update} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="type">Type</Label>
                <LocalizedSelect
                  id="type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                >
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed Amount</option>
                  <option value="bundle">Bundle (requires 2+ products)</option>
                  <option value="seasonal">Seasonal</option>
                </LocalizedSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="value">Value</Label>
                <Input
                  id="value"
                  type="number"
                  step={type === "percentage" ? "0.01" : "0.01"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  required
                  placeholder={type === "percentage" ? "e.g. 10 for 10%" : "Amount"}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="start">Start Date</Label>
                <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="end">End Date</Label>
                <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="status">Status</Label>
              <LocalizedSelect
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="deactivated">Deactivated</option>
              </LocalizedSelect>
            </div>
            <div className="space-y-1">
              <Label>Products (required quantities for bundles)</Label>
              <div className="max-h-60 overflow-y-auto border rounded-md p-2 space-y-1">
{products.map((p) => {
                  const isSelected = !!selectedProducts[p.id];
                  return (
                    <div key={p.id} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 text-sm">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleProduct(p.id)}
                          className="h-4 w-4"
                        />
                        <span>{p.name}</span>
                      </div>
                      {isSelected ? (
                        <Input
                          type="number"
                          min="1"
                          value={selectedProducts[p.id] || 1}
                          onChange={(e) => setQuantity(p.id, Number(e.target.value) || 1)}
                          className="max-w-24"
                          placeholder="Qty"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save Changes"}</Button>
              <Button type="button" variant="outline" onClick={() => void activate()} disabled={status === "active"}>Activate</Button>
              <Button type="button" variant="outline" onClick={() => void deactivate()} disabled={status === "deactivated"}>Deactivate</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

