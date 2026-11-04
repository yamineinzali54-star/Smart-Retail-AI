"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ReceiptLine {
  productName: string | null;
  quantity: number;
  unitPrice: string;
  discount: string;
  lineTotal: string;
}

interface Receipt {
  id: string;
  saleNumber: string;
  saleDate: string;
  subtotal: string;
  discountAmount: string;
  tax: string;
  roundingAdjustment: string;
  grandTotal: string;
  paymentMethod: string;
  cashReceived: string | null;
  cardLast4: string | null;
  paymentReference: string | null;
  mobileProvider: string | null;
  mobileTransactionId: string | null;
  branchCode: string | null;
  branchName: string | null;
  registrationNo: string | null;
  taxInvoicePrefix: string | null;
  notes: string | null;
  lines: ReceiptLine[];
}

export default function ReceiptPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [taxMode, setTaxMode] = useState(false);

  useEffect(() => {
    fetch(`/api/pos/sales/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setReceipt({
          ...data.sale,
          lines: data.sale.lines.map((l: ReceiptLine) => ({ ...l })),
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  const invoiceNo = receipt && taxMode && receipt.taxInvoicePrefix
    ? `${receipt.taxInvoicePrefix}-${receipt.saleNumber}`
    : receipt?.saleNumber;

  return (
    <PageShell
      title={taxMode ? "Tax invoice" : "Receipt preview"}
      subtitle={taxMode ? "IRD-compliant printout" : "80mm thermal template"}
      actions={
        <div className="receipt-print-controls flex gap-2">
          <Link href="/pos/terminal"><Button variant="outline">Back to POS</Button></Link>
          <Button variant="outline" onClick={() => setTaxMode((m) => !m)}>
            {taxMode ? "Receipt view" : "Tax invoice view"}
          </Button>
          <Button onClick={() => window.print()}>Print receipt</Button>
        </div>
      }
    >
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {receipt && (
        <div id="receipt-print-content" className="max-w-sm space-y-3">
          <Card>
            <CardContent className="pt-4 font-mono text-xs">
              <div className="text-center">
                <p className="text-sm font-bold">SmartRetailAI</p>
                {taxMode && <p className="font-bold">TAX INVOICE</p>}
                <p>{invoiceNo}</p>
                <p>{new Date(receipt.saleDate).toLocaleString()}</p>
                {taxMode && receipt.registrationNo && (
                  <p>Reg. No: {receipt.registrationNo}</p>
                )}
              </div>
              <hr className="my-2 border-dashed" />
              {receipt.lines.map((l, i) => (
                <div key={i} className="mb-1">
                  <p>{l.productName ?? "item"}</p>
                  <p className="flex justify-between">
                    <span>{l.quantity} × {l.unitPrice} / unit</span>
                    <span>Line total {l.lineTotal}</span>
                  </p>
                  <p className="text-[10px]">Unit price {l.unitPrice} · Discount {l.discount}</p>
                </div>
              ))}
              <hr className="my-2 border-dashed" />
              <p className="flex justify-between"><span>Subtotal</span><span>{receipt.subtotal}</span></p>
              <p className="flex justify-between"><span>Discount</span><span>{receipt.discountAmount}</span></p>
              <p className="flex justify-between"><span>Tax</span><span>{receipt.tax}</span></p>
              <p className="flex justify-between"><span>Rounding</span><span>{receipt.roundingAdjustment}</span></p>
              <p className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{receipt.grandTotal}</span></p>
              <p className="flex justify-between"><span>Paid ({receipt.paymentMethod})</span><span>{receipt.paymentMethod === "cash" ? (receipt.cashReceived ?? receipt.grandTotal) : receipt.paymentMethod === "card" ? `**** **** **** ${receipt.cardLast4 ?? "----"}` : receipt.paymentMethod === "mobile" ? `${receipt.mobileProvider ?? "mobile"}${receipt.mobileTransactionId ? ` ${receipt.mobileTransactionId}` : ""}` : (receipt.paymentReference ?? receipt.grandTotal)}</span></p>
              {receipt.notes && <p className="mt-1">{receipt.notes}</p>}
              <p className="mt-2 text-center">Thank you — come again</p>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
