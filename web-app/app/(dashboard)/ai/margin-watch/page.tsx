"use client";

import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface MarginFlag {
  product_id: string;
  product_name: string;
  cost: number;
  price: number;
  margin_pct: number;
}

interface AvailableModel {
  id: string;
  provider: string;
  name: string;
  displayName: string;
  isDefault: boolean;
}

const LAST_MODEL_STORAGE_KEY = "smartretail.ai-margin.last-model";

function formatKyat(value: number): string {
  return `K ${Number(value).toLocaleString()}`;
}

export default function MarginWatchPage() {
  const [flags, setFlags] = useState<MarginFlag[]>([]);
  const [itemCount, setItemCount] = useState(0);
  const [insights, setInsights] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);

  async function load(modelId: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (modelId) params.set("modelId", modelId);
      const query = params.toString();
      const response = await fetch(`/api/ai/pricing${query ? `?${query}` : ""}`);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        const code = data?.error ?? `HTTP_${response.status}`;
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
      setFlags(Array.isArray(data.flags) ? data.flags : []);
      setItemCount(typeof data.item_count === "number" ? data.item_count : 0);
      setInsights(typeof data.insights === "string" ? data.insights : "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "REQUEST_FAILED");
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
      await load(initialModelId);
    })();
  }, []);

  return (
    <PageShell
      title="Margin Watch"
      subtitle="Low-margin products based on current branch stock. Review and change prices manually."
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
              void load(id);
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
          <Button variant="outline" onClick={() => void load(selectedModelId)} disabled={loading}>
            Refresh
          </Button>
        </>
      }
    >
      {loading && <p className="text-sm text-muted-foreground">Checking margins…</p>}
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

          <Card>
            <CardHeader>
              <CardTitle>Low-margin products ({flags.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                {itemCount}{" "}<span>stocked products checked against a 10% margin threshold.</span>
              </p>
              {flags.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stocked products are below the threshold.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Average cost</TableHead>
                      <TableHead>Average selling price</TableHead>
                      <TableHead>Margin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {flags.map((flag) => (
                      <TableRow key={flag.product_id}>
                        <TableCell>{flag.product_name || flag.product_id}</TableCell>
                        <TableCell>{formatKyat(flag.cost)}</TableCell>
                        <TableCell>{formatKyat(flag.price)}</TableCell>
                        <TableCell>{flag.margin_pct.toFixed(2)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}
