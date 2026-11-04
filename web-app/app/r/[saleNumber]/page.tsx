import { notFound } from "next/navigation";

interface PublicLine {
  productName: string | null;
  quantity: number;
  unitPrice: string;
  discount: string;
  lineTotal: string;
}

interface PublicReceipt {
  saleNumber: string;
  saleDate: string;
  branchName: string | null;
  subtotal: string;
  discountAmount: string;
  tax: string;
  roundingAdjustment: string;
  grandTotal: string;
  paymentMethod: string;
  lines: PublicLine[];
}

async function loadReceipt(saleNumber: string): Promise<PublicReceipt | null> {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  try {
    const res = await fetch(
      `${base}/api/public/receipts/${encodeURIComponent(saleNumber)}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (!data.ok) return null;
    return data.receipt;
  } catch {
    return null;
  }
}

// Public e-receipt (QR landing page) — no session required.
export default async function PublicReceiptPage({
  params,
}: {
  params: Promise<{ saleNumber: string }>;
}) {
  const { saleNumber } = await params;
  const receipt = await loadReceipt(saleNumber);
  if (!receipt) notFound();

  return (
    <main className="mx-auto max-w-sm p-4 font-mono text-sm">
      <div className="text-center">
        <p className="text-base font-bold">SmartRetailAI</p>
        <p>{receipt.branchName ?? ""}</p>
        <p>{receipt.saleNumber}</p>
        <p>{new Date(receipt.saleDate).toLocaleString()}</p>
      </div>
      <hr className="my-2 border-dashed" />
      {receipt.lines.map((l, i) => (
        <div key={i} className="mb-1">
          <p>{l.productName ?? "item"}</p>
          <p className="flex justify-between">
            <span>{l.quantity} × {l.unitPrice} / unit</span>
            <span>Line total {l.lineTotal}</span>
          </p>
          <p className="text-xs">Discount {l.discount}</p>
        </div>
      ))}
      <hr className="my-2 border-dashed" />
      <p className="flex justify-between"><span>Subtotal</span><span>{receipt.subtotal}</span></p>
      <p className="flex justify-between"><span>Discount</span><span>{receipt.discountAmount}</span></p>
      <p className="flex justify-between"><span>Tax</span><span>{receipt.tax}</span></p>
      <p className="flex justify-between"><span>Rounding</span><span>{receipt.roundingAdjustment}</span></p>
      <p className="flex justify-between text-base font-bold"><span>TOTAL</span><span>{receipt.grandTotal}</span></p>
      <p className="flex justify-between"><span>Paid ({receipt.paymentMethod})</span></p>
      <p className="mt-2 text-center">Thank you — come again</p>
    </main>
  );
}
