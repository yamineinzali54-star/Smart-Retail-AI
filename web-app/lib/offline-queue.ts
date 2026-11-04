"use client";

// Offline POS outbox (§6 offline mode). IndexedDB stores:
// - products/batches: catalog cache used for offline checkout.
// - cart: the offline working cart (server cart is unreachable offline).
// - outbox: completed sales queued offline, replayed through
//   POST /api/pos/checkout/sync on reconnect (max 50 per request).
// Server state stays authoritative: this is a local outbox only.

export interface CachedProduct {
  id: string;
  name: string;
  availableStock: number;
  startingPrice: string | null;
}

export interface CachedBatch {
  id: string;
  productId: string;
  barcode: string;
  currentStockQuantity: number;
  sellingPrice: string;
  expiryDate: string | null;
}

export interface OfflineCartLine {
  productId: string;
  itemId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
}

export interface QueuedSale {
  tempId: string;
  createdAt: string;
  posSessionId: string | null;
  lines: Array<{ productId: string; itemId: string; quantity: number }>;
  paymentMethod: "cash" | "card" | "mobile";
  cashReceived?: string;
  cardNumber?: string;
  paymentReference?: string;
  mobileProvider?: "WavePay" | "KBZPay" | "CBPay" | "AYAPay" | "OnePay";
  mobileTransactionId?: string;
  status?: string;
}

const DB_NAME = "srai-pos-outbox";
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("products")) {
        db.createObjectStore("products", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("batches")) {
        const s = db.createObjectStore("batches", { keyPath: "id" });
        s.createIndex("productId", "productId", { unique: false });
      }
      if (db.objectStoreNames.contains("customers")) {
        db.deleteObjectStore("customers");
      }
      if (!db.objectStoreNames.contains("cart")) {
        db.createObjectStore("cart", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "tempId" });
      } else {
        const outbox = req.transaction?.objectStore("outbox");
        const cursorRequest = outbox?.openCursor();
        cursorRequest?.addEventListener("success", () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const sale = cursor.value as QueuedSale & {
            customerId?: string;
            paymentMethod: string;
          };
          delete sale.customerId;
          if (sale.paymentMethod === ("credit" as string)) {
            sale.status = "legacy_credit_requires_review";
          }
          cursor.update(sale);
          cursor.continue();
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => {
          resolve(req.result);
          db.close();
        };
        req.onerror = () => {
          reject(req.error ?? new Error("IndexedDB request failed"));
          db.close();
        };
      }),
  );
}

function getAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, "readonly", (s) => s.getAll());
}

function put<T>(store: string, value: T): Promise<void> {
  return tx(store, "readwrite", (s) => s.put(value)).then(() => undefined);
}

function del(store: string, key: string): Promise<void> {
  return tx(store, "readwrite", (s) => s.delete(key)).then(() => undefined);
}

// --- Catalog cache (written online, read offline) ---

export async function cacheProducts(products: CachedProduct[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("products", "readwrite");
      const s = t.objectStore("products");
      for (const p of products) s.put(p);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new Error("cache write failed"));
    });
  } finally {
    db.close();
  }
}

export async function searchCachedProducts(q: string): Promise<CachedProduct[]> {
  const all = await getAll<CachedProduct>("products");
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return all
    .filter((p) => p.name.toLowerCase().includes(needle))
    .slice(0, 20);
}

export async function cacheBatches(productId: string, batches: CachedBatch[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("batches", "readwrite");
      const s = t.objectStore("batches");
      const idx = s.index("productId");
      const cursorReq = idx.openKeyCursor(IDBKeyRange.only(productId));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          s.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          for (const b of batches) s.put({ ...b, productId });
          resolve();
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error("cache clear failed"));
      t.onerror = () => reject(t.error ?? new Error("cache write failed"));
    });
  } finally {
    db.close();
  }
}

export async function getCachedBatches(productId: string): Promise<CachedBatch[]> {
  const db = await openDb();
  try {
    return await new Promise<CachedBatch[]>((resolve, reject) => {
      const t = db.transaction("batches", "readonly");
      const req = t.objectStore("batches").index("productId").getAll(productId);
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error ?? new Error("cache read failed"));
    });
  } finally {
    db.close();
  }
}

// --- Offline working cart ---

export async function saveOfflineCart(lines: OfflineCartLine[]): Promise<void> {
  await put("cart", { key: "current", lines });
}

export async function loadOfflineCart(): Promise<OfflineCartLine[]> {
  const rows = await tx<Array<{ key: string; lines: OfflineCartLine[] }>>(
    "cart",
    "readonly",
    (s) => s.getAll(),
  );
  return rows.find((r) => r.key === "current")?.lines ?? [];
}

export async function clearOfflineCart(): Promise<void> {
  await del("cart", "current");
}

// --- Sale outbox ---

// Mirror (§14.3a data-loss mitigation): every outbox mutation is also
// snapshotted to localStorage — a SECOND local store independent of
// IndexedDB. If the IDB database is wiped (browser storage eviction,
// corrupt DB) while localStorage survives, recoverMirror() restores the
// sales back into the outbox on next terminal mount. IDB stays
// authoritative; the mirror is write-through and best-effort (quota or
// private-mode failures only warn, never break the sale flow).

const MIRROR_KEY = "srai-pos-outbox-mirror-v1";
const MIRROR_CAP = 200;

export function serializeMirror(sales: QueuedSale[]): string {
  const trimmed = sales.length > MIRROR_CAP ? sales.slice(-MIRROR_CAP) : sales;
  return JSON.stringify(trimmed);
}

export function parseMirror(raw: string | null): QueuedSale[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is QueuedSale =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as QueuedSale).tempId === "string" &&
        Array.isArray((s as QueuedSale).lines),
    );
  } catch {
    return [];
  }
}

function readMirrorRaw(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(MIRROR_KEY);
  } catch {
    return null;
  }
}

export function readMirror(): QueuedSale[] {
  return parseMirror(readMirrorRaw());
}

/** Overwrite the mirror snapshot. Returns false (warns) instead of throwing. */
export function writeMirror(sales: QueuedSale[]): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(MIRROR_KEY, serializeMirror(sales));
    return true;
  } catch {
    console.warn("[offline-queue] mirror write failed (quota/private mode) — IDB outbox still authoritative");
    return false;
  }
}

/** Best-effort: snapshot the current IDB outbox into the mirror. */
export async function syncMirror(): Promise<void> {
  try {
    writeMirror(await listQueuedSales());
  } catch {
    // listQueuedSales already rejects only when IDB is unusable — nothing to mirror.
  }
}

/**
 * Restore sales from the mirror when the IDB outbox is empty but the mirror
 * is not (IDB wiped, localStorage survived). Returns the restored count.
 * When the outbox is non-empty, heals the mirror direction instead.
 */
export async function recoverMirror(): Promise<{ restored: number }> {
  const [outbox, mirrored] = await Promise.all([
    listQueuedSales().catch(() => [] as QueuedSale[]),
    Promise.resolve(readMirror()),
  ]);
  if (outbox.length > 0) {
    writeMirror(outbox);
    return { restored: 0 };
  }
  let restored = 0;
  for (const sale of mirrored) {
    try {
      await put("outbox", sale);
      restored += 1;
    } catch {
      break;
    }
  }
  return { restored };
}

export function newTempId(): string {
  return `OFF-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
}

export async function enqueueSale(sale: QueuedSale): Promise<void> {
  await put("outbox", sale);
  await syncMirror();
}

export async function listQueuedSales(): Promise<QueuedSale[]> {
  const all = await getAll<QueuedSale>("outbox");
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeQueuedSale(tempId: string): Promise<void> {
  await del("outbox", tempId);
  await syncMirror();
}
