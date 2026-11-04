"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";
import Link from "next/link";

import { PageShell, usePageSession } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Rule {
  antecedent: string;
  consequent: string;
  antecedent_name?: string;
  consequent_name?: string;
  support: number;
  lift: number;
  confidence: number;
}

interface Draft {
  name: string;
  type: string;
  status: string;
  is_ai_suggested: boolean;
  discount_pct: number;
  product_ids: [string, string];
  support: number;
  confidence: number;
}

interface AvailableModel {
  id: string;
  provider: string;
  name: string;
  displayName: string;
  isDefault: boolean;
}

const LAST_MODEL_STORAGE_KEY = "smartretail.ai-basket.last-model";

export default function BasketPage() {
  const { session } = usePageSession();
  const isAdmin = session?.user.role === "admin";
  const [rules, setRules] = useState<Rule[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [transactionCount, setTransactionCount] = useState(0);
  const [insights, setInsights] = useState("");
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);

  async function load(historyDays: number, modelId: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(historyDays) });
      if (modelId) params.set("modelId", modelId);
      const res = await fetch(`/api/ai/basket?${params}`);
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
      setRules(data.rules);
      setDrafts(data.drafts);
      setTransactionCount(data.transaction_count);
      setInsights(data.insights);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
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
      await load(days, initialModelId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveDraft(draft: Draft) {
    const key = draft.product_ids.join("+");
    setSaving(key);
    setSaveError(null);
    try {
      const res = await fetch("/api/ai/basket/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          productIds: draft.product_ids,
          discountPct: draft.discount_pct,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? `HTTP_${res.status}`);
      }
      setSavedIds((prev) => new Set(prev).add(key));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  return (
    <PageShell
      title="Market Basket"
      subtitle="Products frequently bought together — save a rule as a draft bundle for Admin activation at /promotions"
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
              void load(days, id);
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
            value={days}
            onChange={(e) => {
              const d = Number(e.target.value);
              setDays(d);
              void load(d, selectedModelId);
            }}
            className="rounded-md border border-input bg-background px-2 py-2 text-sm"
          >
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
          </LocalizedSelect>
          <Button variant="outline" onClick={() => void load(days, selectedModelId)} disabled={loading}>
            Refresh
          </Button>
        </>
      }
    >
      {loading && <p className="text-sm text-muted-foreground">Mining baskets…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && (
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

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Baskets analyzed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{transactionCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Rules found
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{rules.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Draft bundles
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{drafts.length}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Suggested bundles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {saveError && <p className="text-sm text-red-600">{saveError}</p>}
              {drafts.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No strong pairs yet — rules appear after more multi-item sales accumulate.
                </p>
              )}
              {drafts.map((d) => {
                const key = d.product_ids.join("+");
                const saved = savedIds.has(key);
                return (
                  <div key={key} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">{d.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.discount_pct}% off · support {d.support} · confidence{" "}
                        {Math.round(d.confidence * 100)}%
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">AI draft</Badge>
                      {isAdmin &&
                        (saved ? (
                          <Link href="/promotions">
                            <Button variant="outline" size="sm">
                              Review at /promotions
                            </Button>
                          </Link>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={saving === key}
                            onClick={() => void saveDraft(d)}
                          >
                            {saving === key ? "Saving…" : "Save draft"}
                          </Button>
                        ))}
                    </div>
                  </div>
                );
              })}
              {!isAdmin && drafts.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Saving drafts is admin-only — ask an admin to review these suggestions.
                </p>
              )}
            </CardContent>
          </Card>

          {rules.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Association rules</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Buys</TableHead>
                      <TableHead>Also buys</TableHead>
                      <TableHead>Support</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Lift</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.slice(0, 50).map((r, i) => (
                      <TableRow key={`${r.antecedent}-${r.consequent}-${i}`}>
                        <TableCell>{r.antecedent_name ?? r.antecedent}</TableCell>
                        <TableCell>{r.consequent_name ?? r.consequent}</TableCell>
                        <TableCell>{r.support}</TableCell>
                        <TableCell>{Math.round(r.confidence * 100)}%</TableCell>
                        <TableCell>{r.lift.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}
