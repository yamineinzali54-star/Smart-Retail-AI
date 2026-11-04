"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface DeadItem {
  product_id: string;
  product_name: string;
  on_hand: number;
  stock_value: number;
  days_since_sale: number | null;
}

interface LowStockItem {
  product_id: string;
  product_name: string;
  on_hand: number;
  reorder_threshold: number;
}

interface PriceFlag {
  product_id: string;
  product_name: string;
  min_cost: number;
  max_cost: number;
  change_pct: number;
}

interface AbuseFlag {
  cashier: string;
  voids: number;
  total_sales: number;
  void_rate_pct: number;
  discounts: number;
  flags: string[];
}

interface AvailableModel {
  id: string;
  provider: string;
  name: string;
  displayName: string;
  isDefault: boolean;
}

const LAST_MODEL_STORAGE_KEY = "smartretail.ai-alerts.last-model";

function formatKyat(value: number): string {
  return `K ${Number(value).toLocaleString()}`;
}

export default function AlertsPage() {
  const [dead, setDead] = useState<DeadItem[]>([]);
  const [prices, setPrices] = useState<PriceFlag[]>([]);
  const [abuse, setAbuse] = useState<AbuseFlag[]>([]);
  const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [insights, setInsights] = useState("");
  const [deadDays, setDeadDays] = useState(60);
  const [loading, setLoading] = useState(true);
  const [aiError, setAiError] = useState<string | null>(null);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);

  // Low-stock data comes from the web-app DB (same rule as the Telegram
  // alert scan) so it always shows, even when the AI service is down.
  async function loadLowStock() {
    try {
      const res = await fetch("/api/admin/alerts/low-stock");
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setLowStock(Array.isArray(data.low_stock) ? data.low_stock : []);
        setLowStockCount(typeof data.count === "number" ? data.count : 0);
      }
    } catch {
      // Low-stock panel is best-effort; the page still works without it.
    }
  }

  async function load(days: number, modelId: string) {
    setLoading(true);
    setAiError(null);
    try {
      const params = new URLSearchParams({ dead_days: String(days) });
      if (modelId) params.set("modelId", modelId);
      const res = await fetch(`/api/ai/alerts?${params}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const code = data?.error ?? `HTTP_${res.status}`;
        throw new Error(
          code === "AI_UNAVAILABLE"
            ? "AI service is unreachable. Start it with `uvicorn app.main:app --port 8000` in ai-service, then retry."
            : code === "AI_QUOTA_EXCEEDED"
              ? "Provider rate or spending limit reached. Check provider usage and retry later."
              : code === "AI_MODEL_UNAVAILABLE"
                ? "The selected AI model is unavailable. Choose another active model."
                : `Request failed (${code}).`,
        );
      }
      setDead(data.dead_stock);
      setPrices(data.price_flags);
      setAbuse(data.abuse_flags);
      setInsights(data.insights);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      let initialModelId = "";
      try {
        const response = await fetch("/api/ai/models");
        const data = await response.json();
        if (response.ok && data.ok) {
          const available = data.models as AvailableModel[];
          setModels(available);
          let rememberedId = "";
          try {
            rememberedId = localStorage.getItem(LAST_MODEL_STORAGE_KEY) ?? "";
          } catch {
            // Storage may be disabled; use the configured default instead.
          }
          const selected = available.find((model) => model.id === rememberedId)
            ?? available.find((model) => model.isDefault)
            ?? available[0];
          initialModelId = selected?.id ?? "";
          setSelectedModelId(initialModelId);
        }
      } catch {
        setModels([]);
      } finally {
        setModelsLoading(false);
      }
      // Low-stock loads in parallel with the AI alerts — it must not be
      // blocked by (or block) the AI service round-trip.
      void loadLowStock();
      await load(deadDays, initialModelId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aiTotal = dead.length + prices.length + abuse.length;

  return (
    <PageShell
      title="Ops Alerts"
      subtitle="Rule-based watchlist — dead stock, supplier price drift, void/discount outliers. Refreshed on every load."
      allow={["admin", "inventory"]}
      actions={
        <>
          <LocalizedSelect
            value={selectedModelId}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedModelId(id);
              try {
                localStorage.setItem(LAST_MODEL_STORAGE_KEY, id);
              } catch {
                // Storage may be disabled; selection stays in memory only.
              }
              void load(deadDays, id);
            }}
            disabled={modelsLoading || models.length === 0}
            aria-label="AI model"
            className="rounded-md border border-input bg-background px-2 py-2 text-sm"
          >
            {models.length === 0 && <option value="">No AI models</option>}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </LocalizedSelect>
          <LocalizedSelect
            value={deadDays}
            onChange={(e) => {
              const d = Number(e.target.value);
              setDeadDays(d);
              void load(d, selectedModelId);
            }}
            className="rounded-md border border-input bg-background px-2 py-2 text-sm"
          >
            <option value={30}>Idle 30+ days</option>
            <option value={60}>Idle 60+ days</option>
            <option value={90}>Idle 90+ days</option>
          </LocalizedSelect>
          <Button variant="outline" onClick={() => { void loadLowStock(); void load(deadDays, selectedModelId); }} disabled={loading}>
            Refresh
          </Button>
        </>
      }
    >
      {loading && <p className="text-sm text-muted-foreground">Scanning…</p>}
      {aiError && (
        <p className="text-sm text-amber-600">
          {aiError} — Low stock data below is still current; dead-stock, price-drift and abuse panels need the AI service.
        </p>
      )}

      {(
        <>
          {lowStockCount > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Low stock ({lowStockCount})</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  Products whose total stock is at or below reorder threshold (stock &gt; 0). Same rule as the daily Telegram alert.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>On hand</TableHead>
                      <TableHead>Threshold</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowStock.slice(0, 50).map((item) => (
                      <TableRow key={item.product_id}>
                        <TableCell>{item.product_name || item.product_id}</TableCell>
                        <TableCell>
                          <Badge variant={item.on_hand === 0 ? "destructive" : "outline"}>
                            {item.on_hand}
                          </Badge>
                        </TableCell>
                        <TableCell>{item.reorder_threshold}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {lowStock.length > 50 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing first 50 of {lowStock.length}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {!loading && !aiError && (
            <>
              {insights && (
                <Card>
                  <CardHeader>
                    <CardTitle>Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{insights}</p>
                  </CardContent>
                </Card>
              )}

              {aiTotal === 0 && lowStockCount === 0 && (
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">
                      All clear — no low stock, dead stock, price drift, or abuse outliers in this window.
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {!loading && !aiError && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Dead stock ({dead.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {dead.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing idle — every stocked product sold recently.
                    </p>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={Math.max(160, Math.min(300, dead.length * 26))}>
                        <BarChart
                          data={dead.slice(0, 15).map((d) => ({
                            name: (d.product_name || d.product_id).length > 20
                              ? (d.product_name || d.product_id).slice(0, 18) + "…"
                              : d.product_name || d.product_id,
                            value: d.stock_value,
                          }))}
                          layout="vertical"
                          margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                        >
                          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                          <XAxis type="number" tickLine={false} axisLine={false} />
                          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={140} />
                          <Tooltip formatter={(v) => [`K ${Number(v).toLocaleString()}`, "Capital tied"]} />
                          <Bar dataKey="value" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                      {dead.length > 15 && (
                        <p className="mt-1 mb-2 text-xs text-muted-foreground">Top 15 by capital tied — table shows all.</p>
                      )}
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead>On hand</TableHead>
                            <TableHead>Capital tied</TableHead>
                            <TableHead>Idle since</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dead.slice(0, 50).map((d) => (
                            <TableRow key={d.product_id}>
                              <TableCell>{d.product_name || d.product_id}</TableCell>
                              <TableCell>{d.on_hand}</TableCell>
                              <TableCell>{formatKyat(d.stock_value)}</TableCell>
                              <TableCell>
                                {d.days_since_sale === null
                                  ? "never sold"
                                  : `${Math.round(d.days_since_sale)} days`}
                              </TableCell>
                              <TableCell>
                                <Link href="/expiry">
                                  <Button variant="ghost" size="sm">
                                    Review expiry
                                  </Button>
                                </Link>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Supplier price drift ({prices.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {prices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      GRN costs are stable across recent receipts.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Lowest cost</TableHead>
                          <TableHead>Highest cost</TableHead>
                          <TableHead>Change</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {prices.slice(0, 50).map((p) => (
                          <TableRow key={p.product_id}>
                            <TableCell>{p.product_name || p.product_id}</TableCell>
                            <TableCell>{formatKyat(p.min_cost)}</TableCell>
                            <TableCell>{formatKyat(p.max_cost)}</TableCell>
                            <TableCell>
                              <Badge variant={p.change_pct >= 10 ? "destructive" : "outline"}>
                                +{p.change_pct}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Void / discount outliers ({abuse.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  {abuse.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No cashier exceeds the void/discount thresholds.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cashier</TableHead>
                          <TableHead>Voids</TableHead>
                          <TableHead>Void rate</TableHead>
                          <TableHead>Discounts given</TableHead>
                          <TableHead>Flags</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {abuse.map((a) => (
                          <TableRow key={a.cashier}>
                            <TableCell>{a.cashier}</TableCell>
                            <TableCell>
                              {a.voids}/{a.total_sales}
                            </TableCell>
                            <TableCell>{a.void_rate_pct}%</TableCell>
                            <TableCell>{formatKyat(a.discounts)}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {a.flags.map((f) => (
                                  <Badge key={f} variant="destructive">
                                    {f}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
