// Numbering generators (PLAN S5). Formats embed {branchCode}; enforce
// uniqueness via DB unique constraint + retry-on-collision in application code.
// Full implementation + collision retry lands with the first entity using it.
export function buildPurchaseOrderNumber(
  branchCode: string,
  now: Date = new Date(),
): string {
  return `PO-${branchCode}-${formatTimestamp(now)}`;
}

export function buildGrnNumber(branchCode: string, now: Date = new Date()): string {
  const yy = String(now.getFullYear()).slice(2);
  return `GRN-${branchCode}-${yy}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function buildTransferNumber(
  fromBranchCode: string,
  toBranchCode: string,
  now: Date = new Date(),
): string {
  return `TRF-${fromBranchCode}-${toBranchCode}-${formatTimestamp(now)}`;
}

export function buildDebitNoteNumber(
  branchCode: string,
  now: Date = new Date(),
): string {
  return `DN-${branchCode}-${formatTimestamp(now)}`;
}

export function buildReorderNumber(
  branchCode: string,
  now: Date = new Date(),
): string {
  return `PO-${branchCode}-RO-${formatTimestamp(now)}`;
}

export function buildGroundBalanceBatch(
  branchCode: string,
  now: Date = new Date(),
): string {
  return `GB-${branchCode}-${formatTimestamp(now)}`;
}

export function buildAdjustmentNumber(
  branchCode: string,
  now: Date = new Date(),
): string {
  return `ADJ-${branchCode}-${formatTimestamp(now)}`;
}

export function buildSaleReturnNumber(originalSaleNumber: string, seq: number): string {
  return `RET-${originalSaleNumber}-${seq}`;
}

export function buildSaleNumber(
  branchCode: string,
  date: Date = new Date(),
  sequence: number,
): string {
  const ymd = formatDate(date);
  return `SALE-${branchCode}-${ymd}-${String(sequence).padStart(4, "0")}`;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function formatTimestamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
