"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import QRCode from "react-qr-code"
import { BrowserMultiFormatReader } from "@zxing/browser"
import type { IScannerControls } from "@zxing/browser"

import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  cacheBatches,
  cacheProducts,
  clearOfflineCart,
  enqueueSale,
  getCachedBatches,
  listQueuedSales,
  loadOfflineCart,
  newTempId,
  recoverMirror,
  removeQueuedSale,
  saveOfflineCart,
  searchCachedProducts,
  type CachedBatch,
  type OfflineCartLine,
  type QueuedSale,
} from "@/lib/offline-queue"

interface SearchProduct {
  id: string
  name: string
  availableStock: number
  startingPrice: string | null
}

interface PosCategory {
  id: string
  name: string
  productCount: number
}

interface Batch {
  id: string
  barcode: string
  currentStockQuantity: number
  sellingPrice: string
  expiryDate: string | null
}

interface CartLine {
  id: string
  productName: string | null
  quantity: number
  unitPrice: string
  promoDiscount: string
  lineTax: string
  lineTotal: string
}

interface Cart {
  items: CartLine[]
  subtotal: string
  discountAmount: string
  tax: string
  grandTotal: string
  itemCount: number
}

interface CheckoutInvoice {
  id: string
  saleNumber: string
  saleDate: string
  branchName: string | null
  registrationNo: string | null
  taxInvoicePrefix: string | null
  subtotal: string
  discountAmount: string
  tax: string
  roundingAdjustment: string
  grandTotal: string
  paymentMethod: string
  cashReceived: string | null
  cardLast4: string | null
  paymentReference: string | null
  mobileProvider: string | null
  mobileTransactionId: string | null
  notes: string | null
  lines: Array<{
    productName: string | null
    quantity: number
    unitPrice: string
    discount: string
    lineTotal: string
  }>
}

export default function PosTerminalPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchProduct[]>([])
  const [categories, setCategories] = useState<PosCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState<PosCategory | null>(
    null
  )
  const [batches, setBatches] = useState<Batch[]>([])
  const [batchProduct, setBatchProduct] = useState<SearchProduct | null>(null)
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null)
  const [selectedQuantity, setSelectedQuantity] = useState(1)
  const [addingBatch, setAddingBatch] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [cart, setCart] = useState<Cart | null>(null)
  const [cartUpdating, setCartUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<CheckoutInvoice | null>(null)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [taxInvoiceMode, setTaxInvoiceMode] = useState(false)
  const [cashReceived, setCashReceived] = useState("")
  const [parkedCarts, setParkedCarts] = useState<
    Array<{ id: string; label: string | null; updatedAt: string }>
  >([])
  const [parkLabel, setParkLabel] = useState("")
  // Offline mode (IndexedDB outbox + catalog cache).
  const [online, setOnline] = useState(true)
  const [localCart, setLocalCart] = useState<OfflineCartLine[]>([])
  const [queued, setQueued] = useState<QueuedSale[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  // Refs mirror state for use inside listeners/timeouts (stale closures).
  const sessionIdRef = useRef<string | null>(null)
  const syncingRef = useRef(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerControlsRef = useRef<IScannerControls | null>(null)
  const searchRef = useRef<(searchText?: string) => Promise<void>>(
    async () => undefined
  )

  function setSessionIdBoth(id: string | null): void {
    sessionIdRef.current = id
  }

  const publicInvoiceBaseUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3000")
  ).replace(/\/+$/, "")
  const publicInvoiceUrl = invoice
    ? `${publicInvoiceBaseUrl}/r/${encodeURIComponent(invoice.saleNumber)}`
    : ""

  async function refreshCart() {
    const res = await fetch("/api/pos/cart")
    const data = await res.json()
    if (data.ok) setCart(data.cart)
  }

  useEffect(() => {
    fetch("/api/pos-sessions/current")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          router.push("/pos/select-counter")
          return
        }
        setSessionIdBoth(data.session?.id ?? null)
        setReady(true)
        void Promise.resolve().then(() => refreshCart())
        void Promise.resolve().then(() => refreshParked())
        void Promise.resolve().then(() => refreshCategories())
      })
      .catch(() => {
        // Network failure at mount = offline: allow local selling, queue later.
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          setOnline(false)
          setReady(true)
        } else {
          setError("Failed to load session")
        }
      })
    void Promise.resolve().then(() =>
      loadOfflineCart()
        .then(setLocalCart)
        .catch(() => undefined)
    )
    // Mirror recovery (§14.3a): if IndexedDB was wiped but the localStorage
    // mirror survived, restore the sales back into the outbox.
    void listQueuedSales()
      .then(async (q) => {
        if (q.length > 0) {
          setQueued(q)
          return
        }
        const { restored } = await recoverMirror().catch(() => ({
          restored: 0,
        }))
        if (restored > 0) {
          const refreshed = await listQueuedSales().catch(() => [])
          setQueued(refreshed)
          setSyncMsg(`${restored} offline sale(s) recovered from backup store.`)
        } else {
          setQueued(q)
        }
      })
      .catch(() => undefined)
  }, [router])

  useEffect(() => {
    if (!scannerOpen) return
    let active = true
    const stopStream = () => {
      scannerControlsRef.current?.stop()
      scannerControlsRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
    }

    const startScanner = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScannerError(
          "Camera access မရနိုင်ပါ။ HTTPS သို့မဟုတ် localhost မှဖွင့်ပြီး barcode ကို search box ထဲရိုက်ထည့်ပါ။"
        )
        return
      }
      try {
        const video = videoRef.current
        if (!video) return
        setScannerError(null)
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints(
          {
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          },
          video,
          (result) => {
            const value = result?.getText().trim()
            if (!active || !value) return
            setQuery(value)
            setSelectedCategory(null)
            setScannerOpen(false)
            void searchRef.current(value)
          }
        )
        if (!active) controls.stop()
        else scannerControlsRef.current = controls
      } catch {
        setScannerError(
          "Webcam ဖွင့်မရပါ သို့မဟုတ် barcode ဖတ်မရပါ။ Camera permission ကိုခွင့်ပြုပြီး အလင်းရောင်ကောင်းသောနေရာတွင် ထပ်ကြိုးစားပါ။"
        )
      }
    }

    void startScanner()
    return () => {
      active = false
      stopStream()
    }
  }, [scannerOpen])

  // Connectivity changes: auto-sync the outbox on reconnect.
  useEffect(() => {
    const onUp = () => {
      setOnline(true)
      void Promise.resolve().then(() => syncOutbox())
    }
    const onDown = () => setOnline(false)
    window.addEventListener("online", onUp)
    window.addEventListener("offline", onDown)
    return () => {
      window.removeEventListener("online", onUp)
      window.removeEventListener("offline", onDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function syncOutbox(): Promise<void> {
    if (syncingRef.current) return
    let pending: QueuedSale[] = []
    try {
      pending = await listQueuedSales()
    } catch {
      return
    }
    if (pending.length === 0) {
      setQueued([])
      return
    }
    // Need a live session to replay: fetch it if we don't have one.
    let sid = sessionIdRef.current
    if (!sid) {
      try {
        const res = await fetch("/api/pos-sessions/current")
        const data = await res.json()
        if (!data.ok) {
          setSyncMsg(
            "Back online, but no active POS session — open one to sync."
          )
          return
        }
        sid = data.session?.id ?? null
        setSessionIdBoth(sid)
      } catch {
        setSyncMsg("Still offline — sales stay queued.")
        return
      }
    }
    if (!sid) {
      setSyncMsg("No active POS session — open one to sync queued sales.")
      return
    }
    setSyncing(true)
    syncingRef.current = true
    setSyncMsg(null)
    try {
      // Sync endpoint caps at 50 sales per request.
      for (let i = 0; i < pending.length; i += 50) {
        const chunk = pending.slice(i, i + 50).map((q) => ({
          tempId: q.tempId,
          lines: q.lines,
          paymentMethod: q.paymentMethod,
          cashReceived: q.cashReceived,
          cardNumber: q.cardNumber,
          paymentReference: q.paymentReference,
          mobileProvider: q.mobileProvider,
          mobileTransactionId: q.mobileTransactionId,
        }))
        const res = await fetch("/api/pos/checkout/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ posSessionId: sid, sales: chunk }),
        })
        const data = await res.json()
        if (!data.ok) throw new Error(data.error || "Sync failed")
        for (const r of data.results as Array<{
          tempId: string
          status: string
          saleNumber?: string
        }>) {
          if (r.status === "synced") {
            await removeQueuedSale(r.tempId)
          } else {
            // Keep the failed sale queued for retry/discard; surface the cause.
            const failed = pending.find((q) => q.tempId === r.tempId)
            if (failed)
              await enqueueSale({
                ...failed,
                posSessionId: sid,
                status: r.status,
              })
          }
        }
      }
      const remaining = await listQueuedSales()
      setQueued(remaining)
      const done = pending.length - remaining.length
      setSyncMsg(
        remaining.length === 0
          ? `All ${done} queued sale(s) synced.`
          : `${done} synced, ${remaining.length} need review (see queue).`
      )
      void refreshCart()
    } catch {
      setSyncMsg("Sync failed — sales stay queued, will retry.")
    } finally {
      setSyncing(false)
      syncingRef.current = false
    }
  }

  async function refreshCategories() {
    try {
      const res = await fetch("/api/pos/categories")
      const data = await res.json()
      if (data.ok) {
        setCategories(data.categories)
        setOnline(true)
      }
    } catch {
      setOnline(false)
    }
  }

  async function search(searchText = query) {
    const value = searchText.trim()
    if (!value) return
    setError(null)
    setSelectedCategory(null)
    setBatchProduct(null)
    setSelectedBatch(null)
    try {
      const res = await fetch(
        `/api/pos/products/search?q=${encodeURIComponent(value)}`
      )
      const data = await res.json()
      if (data.ok) {
        setResults(data.products)
        setOnline(true)
        void cacheProducts(data.products).catch(() => undefined)
        return
      }
      setError(data.error || "Search failed")
    } catch {
      setOnline(false)
      setResults(await searchCachedProducts(value).catch(() => []))
    }
  }
  searchRef.current = search

  async function openCategory(category: PosCategory) {
    setError(null)
    setQuery("")
    setSelectedCategory(category)
    setBatchProduct(null)
    setSelectedBatch(null)
    setBatches([])
    try {
      const res = await fetch(
        `/api/pos/products/search?categoryId=${encodeURIComponent(category.id)}`
      )
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || "Could not load category products.")
        return
      }
      setResults(data.products)
      setOnline(true)
      void cacheProducts(data.products).catch(() => undefined)
    } catch {
      setOnline(false)
      setResults([])
      setError(
        "Category products need an internet connection. Search cached products while offline."
      )
    }
  }

  function backToCategories() {
    setSelectedCategory(null)
    setResults([])
    setBatchProduct(null)
    setSelectedBatch(null)
    setBatches([])
  }

  async function showBatches(p: SearchProduct) {
    setBatchProduct(p)
    setBatches([])
    setSelectedBatch(null)
    setSelectedQuantity(1)
    try {
      const res = await fetch(`/api/pos/products/${p.id}/stock?pageSize=100`)
      const data = await res.json()
      if (data.ok) {
        setBatches(data.batches)
        setOnline(true)
        void cacheBatches(p.id, data.batches).catch(() => undefined)
        return
      }
      setError(data.error || "Stock lookup failed")
    } catch {
      setOnline(false)
      setBatches(await getCachedBatches(p.id).catch(() => []))
    }
  }

  function batchToCached(b: Batch, productId: string): CachedBatch {
    return {
      id: b.id,
      productId,
      barcode: b.barcode,
      currentStockQuantity: b.currentStockQuantity,
      sellingPrice: b.sellingPrice,
      expiryDate: b.expiryDate,
    }
  }

  async function add(
    productId: string,
    itemId: string,
    quantity = 1
  ): Promise<boolean> {
    setError(null)
    if (!online) {
      // Offline: build the cart locally from cached batch data.
      const cached = (await getCachedBatches(productId).catch(() => [])).find(
        (b) => b.id === itemId
      )
      const fallback = batches.find((b) => b.id === itemId)
      const src =
        cached ?? (fallback ? batchToCached(fallback, productId) : null)
      if (!src) {
        setError("Batch not cached — go online once to cache stock first.")
        return false
      }
      const name =
        batchProduct?.id === productId ? batchProduct.name : productId
      const existingQuantity =
        localCart.find((line) => line.itemId === itemId)?.quantity ?? 0
      if (existingQuantity + quantity > src.currentStockQuantity) {
        setError("There is not enough cached stock for that quantity.")
        return false
      }
      setLocalCart((prev) => {
        const next = [...prev]
        const line = next.find((l) => l.itemId === itemId)
        if (line) line.quantity += quantity
        else {
          next.push({
            productId,
            itemId,
            productName: name,
            quantity,
            unitPrice: src.sellingPrice,
          })
        }
        void saveOfflineCart(next).catch(() => undefined)
        return next
      })
      return true
    }
    try {
      const res = await fetch("/api/pos/cart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, itemId, quantity }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || "Add failed")
        return false
      }
      await refreshCart()
      return true
    } catch {
      setOnline(false)
      setError("Connection lost — now in offline mode.")
      return false
    }
  }

  async function confirmBatchAdd() {
    if (!batchProduct || !selectedBatch || addingBatch) return
    setAddingBatch(true)
    try {
      const added = await add(
        batchProduct.id,
        selectedBatch.id,
        selectedQuantity
      )
      if (added) {
        setSelectedBatch(null)
        setSelectedQuantity(1)
        setBatches([])
        setBatchProduct(null)
      }
    } finally {
      setAddingBatch(false)
    }
  }

  async function updateCartQuantity(line: CartLine, quantity: number) {
    if (!online) return
    setError(null)
    setCartUpdating(true)
    try {
      const res = await fetch("/api/pos/cart", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cartItemId: line.id, quantity }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(
          data.error === "INSUFFICIENT_STOCK"
            ? "There is not enough stock for that quantity."
            : data.error || "Could not update cart quantity."
        )
        return
      }
      await refreshCart()
    } catch {
      setOnline(false)
      setError("Connection lost — quantity was not changed.")
    } finally {
      setCartUpdating(false)
    }
  }

  async function removeCartItem(line: CartLine) {
    if (!online) return
    setError(null)
    setCartUpdating(true)
    try {
      const res = await fetch(
        `/api/pos/cart?cartItemId=${encodeURIComponent(line.id)}`,
        { method: "DELETE" }
      )
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || "Could not remove item from cart.")
        return
      }
      await refreshCart()
    } catch {
      setOnline(false)
      setError("Connection lost — item was not removed.")
    } finally {
      setCartUpdating(false)
    }
  }

  async function clearCart() {
    if (!online) {
      setLocalCart([])
      await clearOfflineCart().catch(() => undefined)
      return
    }
    setError(null)
    setCartUpdating(true)
    try {
      const res = await fetch("/api/pos/cart?clear=true", { method: "DELETE" })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || "Could not clear cart.")
        return
      }
      await refreshCart()
    } catch {
      setOnline(false)
      setError("Connection lost — cart was not cleared.")
    } finally {
      setCartUpdating(false)
    }
  }

  async function updateOfflineQuantity(
    line: OfflineCartLine,
    quantity: number
  ) {
    if (quantity > line.quantity) {
      const cached = await getCachedBatches(line.productId).catch(() => [])
      const batch = cached.find((b) => b.id === line.itemId)
      if (batch && quantity > batch.currentStockQuantity) {
        setError("There is not enough cached stock for that quantity.")
        return
      }
    }
    setLocalCart((prev) => {
      const next = prev.map((item) =>
        item.itemId === line.itemId ? { ...item, quantity } : item
      )
      void saveOfflineCart(next).catch(() => undefined)
      return next
    })
  }

  function removeOfflineItem(line: OfflineCartLine) {
    setLocalCart((prev) => {
      const next = prev.filter((item) => item.itemId !== line.itemId)
      void saveOfflineCart(next).catch(() => undefined)
      return next
    })
  }

  async function refreshParked() {
    const res = await fetch("/api/pos/cart/parked")
    const data = await res.json()
    if (data.ok) setParkedCarts(data.parked)
  }

  async function parkCart() {
    setError(null)
    const res = await fetch("/api/pos/cart/park", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: parkLabel || undefined }),
    })
    const data = await res.json()
    if (!data.ok) {
      setError(data.error || "Park failed")
      return
    }
    setParkLabel("")
    setCart(null)
    void refreshParked()
  }

  async function resumeCart(cartId: string) {
    setError(null)
    const res = await fetch("/api/pos/cart/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cartId }),
    })
    const data = await res.json()
    if (!data.ok) {
      setError(data.error || "Resume failed")
      return
    }
    await Promise.all([refreshCart(), refreshParked()])
  }

  async function checkout(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInvoice(null)
    setInvoiceOpen(false)
    // Offline sales are queued and synced once connectivity returns.
    if (!online) {
      if (localCart.length === 0) {
        setError("Offline cart is empty.")
        return
      }
      if (!cashReceived) {
        setError("Enter cash received.")
        return
      }
      const tempId = newTempId()
      try {
        await enqueueSale({
          tempId,
          createdAt: new Date().toISOString(),
          posSessionId: sessionIdRef.current,
          lines: localCart.map((l) => ({
            productId: l.productId,
            itemId: l.itemId,
            quantity: l.quantity,
          })),
          paymentMethod: "cash",
          cashReceived,
        })
      } catch {
        setError("Could not save offline — browser storage unavailable.")
        return
      }
      setLocalCart([])
      await clearOfflineCart().catch(() => undefined)
      setCashReceived("")
      setQueued(await listQueuedSales().catch(() => []))
      setSyncMsg(`Sale ${tempId} queued offline — it will sync on reconnect.`)
      return
    }
    let res: Response
    try {
      res = await fetch("/api/pos/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paymentMethod: "cash",
          cashReceived,
        }),
      })
    } catch {
      // Connection dropped mid-checkout — flip to offline mode. The sale may
      // or may not have completed server-side; the cashier verifies via
      // Today's sales once back online (no blind duplicate queueing).
      setOnline(false)
      setError(
        "Connection lost — back in offline mode. Verify this sale in Today's sales after reconnect."
      )
      return
    }
    const data = await res.json()
    if (!data.ok) {
      if (data.error === "CASH_INSUFFICIENT") {
        const amountDue =
          typeof data.amountDue === "string" ? data.amountDue : cart?.grandTotal
        await refreshCart().catch(() => undefined)
        setError(
          amountDue
            ? `ငွေမလုံလောက်ပါ။ ပေးရန်စုစုပေါင်း ${amountDue} ဖြစ်ပါတယ်။ ထိုပမာဏနှင့်အထက် ငွေထည့်ပါ။`
            : "ငွေမလုံလောက်ပါ။ ပေးရန်စုစုပေါင်းနှင့်အထက် ငွေထည့်ပါ။"
        )
        return
      }
      setError(data.error || "Checkout failed")
      return
    }
    setCart(null)
    setCashReceived("")
    setTaxInvoiceMode(false)
    try {
      const invoiceResponse = await fetch(`/api/pos/sales/${data.sale.id}`)
      const invoiceData = await invoiceResponse.json()
      if (!invoiceResponse.ok || !invoiceData.ok) {
        setError(
          `Sale ${data.sale.saleNumber} completed, but invoice preview could not be loaded.`
        )
      } else {
        setInvoice(invoiceData.sale as CheckoutInvoice)
        setInvoiceOpen(true)
      }
    } catch {
      setError(
        `Sale ${data.sale.saleNumber} completed, but invoice preview could not be loaded.`
      )
    }
    // Piggyback: flush any previously queued offline sales now that we are
    // demonstrably online.
    void syncOutbox()
  }

  if (!ready) {
    return (
      <PageShell title="POS terminal">
        <p className="text-sm text-muted-foreground">
          {error ?? "Checking session…"}
        </p>
      </PageShell>
    )
  }

  return (
    <PageShell
      title="POS terminal"
      actions={
        <Link href="/pos/end-session">
          <Button variant="outline">End session</Button>
        </Link>
      }
    >
      {!online && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Offline mode — selling from cached catalog. Completed sales queue on
          this device and sync automatically on reconnect.
        </div>
      )}
      {syncMsg && (
        <div className="mb-4 rounded-md border p-3 text-sm text-muted-foreground">
          {syncMsg}
        </div>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Search products</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Name or barcode…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void search()
                  }}
                />
                <Button variant="outline" onClick={() => void search()}>
                  Search
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-pressed={scannerOpen}
                  onClick={() => {
                    setScannerError(null)
                    setScannerOpen((open) => !open)
                  }}
                >
                  {scannerOpen ? "Close scanner" : "Scan barcode"}
                </Button>
              </div>
              {scannerOpen && (
                <div className="space-y-2 rounded-md border p-2">
                  <video
                    ref={videoRef}
                    className="mx-auto max-h-64 w-full rounded-md bg-black object-contain"
                    autoPlay
                    muted
                    playsInline
                  />
                  <p className="text-xs text-muted-foreground">
                    Barcode ကို camera frame အတွင်းထားပါ။
                  </p>
                  {scannerError && (
                    <p className="text-sm text-red-600">{scannerError}</p>
                  )}
                </div>
              )}
              {selectedCategory ? (
                <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
                  <div>
                    <p className="font-medium">{selectedCategory.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {results.length} product(s)
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={backToCategories}
                  >
                    All categories
                  </Button>
                </div>
              ) : !query.trim() && online ? (
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  <p className="text-sm font-medium">Categories</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {categories.map((category) => (
                      <Button
                        key={category.id}
                        type="button"
                        variant="outline"
                        className="h-auto min-h-16 flex-col items-start p-3 text-left whitespace-normal"
                        onClick={() => void openCategory(category)}
                      >
                        <span>{category.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {category.productCount} product(s)
                        </span>
                      </Button>
                    ))}
                  </div>
                  {categories.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No categories available.
                    </p>
                  )}
                </div>
              ) : null}
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {results.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-md border p-2 text-sm"
                  >
                    <span>
                      {p.name} (have {p.availableStock}
                      {p.startingPrice ? ` from ${p.startingPrice}` : ""})
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void showBatches(p)}
                    >
                      Batches
                    </Button>
                  </div>
                ))}
                {selectedCategory && results.length === 0 && !error && (
                  <p className="text-sm text-muted-foreground">
                    No available products in this category.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          {batchProduct && (
            <Card>
              <CardHeader>
                <CardTitle>FEFO batches — {batchProduct.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {batches.map((b) => (
                  <div
                    key={b.id}
                    className={`flex items-center justify-between rounded-md border p-2 text-sm ${selectedBatch?.id === b.id ? "border-primary bg-muted/40" : ""}`}
                  >
                    <span>
                      {b.barcode} · {b.sellingPrice} · stock{" "}
                      {b.currentStockQuantity}
                      {b.expiryDate
                        ? ` · exp ${new Date(b.expiryDate).toLocaleDateString()}`
                        : ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        selectedBatch?.id === b.id ? "default" : "outline"
                      }
                      onClick={() => {
                        setSelectedBatch(b)
                        setSelectedQuantity(1)
                      }}
                    >
                      Select batch
                    </Button>
                  </div>
                ))}
                {batches.length === 0 && (
                  <p className="text-sm text-muted-foreground">No stock.</p>
                )}
                {selectedBatch && (
                  <div className="space-y-2 rounded-md border p-3">
                    <p className="text-sm font-medium">
                      {selectedBatch.barcode} · {selectedBatch.sellingPrice}{" "}
                      each
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Quantity</span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label="Decrease selected quantity"
                        disabled={selectedQuantity <= 1}
                        onClick={() =>
                          setSelectedQuantity((quantity) =>
                            Math.max(1, quantity - 1)
                          )
                        }
                      >
                        −
                      </Button>
                      <span className="min-w-8 text-center">
                        {selectedQuantity}
                      </span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label="Increase selected quantity"
                        disabled={
                          selectedQuantity >= selectedBatch.currentStockQuantity
                        }
                        onClick={() =>
                          setSelectedQuantity((quantity) =>
                            Math.min(
                              selectedBatch.currentStockQuantity,
                              quantity + 1
                            )
                          )
                        }
                      >
                        +
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        of {selectedBatch.currentStockQuantity} in stock
                      </span>
                    </div>
                    <Button
                      type="button"
                      disabled={addingBatch}
                      onClick={() => void confirmBatchAdd()}
                    >
                      {addingBatch ? "Adding…" : "Confirm and add to cart"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  Cart {cart ? `(${cart.itemCount} items)` : ""}
                </CardTitle>
                {cart && cart.items.length > 0 && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={cartUpdating}
                      onClick={() => void parkCart()}
                    >
                      Park
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={cartUpdating}
                      onClick={() => void clearCart()}
                    >
                      Clear cart
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {!cart || cart.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Cart is empty.</p>
              ) : (
                <>
                  {cart.items.map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate">{l.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          တစ်ခုဈေး {l.unitPrice} · စုစုပေါင်း {l.lineTotal}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Decrease ${l.productName} quantity`}
                          disabled={cartUpdating || l.quantity <= 1}
                          onClick={() =>
                            void updateCartQuantity(l, l.quantity - 1)
                          }
                        >
                          −
                        </Button>
                        <span className="min-w-6 text-center">
                          {l.quantity}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={`Increase ${l.productName} quantity`}
                          disabled={cartUpdating}
                          onClick={() =>
                            void updateCartQuantity(l, l.quantity + 1)
                          }
                        >
                          +
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={cartUpdating}
                          onClick={() => void removeCartItem(l)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className="border-t pt-2 text-sm">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>{cart.subtotal}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Discount</span>
                      <span>{cart.discountAmount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tax</span>
                      <span>{cart.tax}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Total</span>
                      <span>{cart.grandTotal}</span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          {parkedCarts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Parked Carts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {parkedCarts.map((pc) => (
                  <div
                    key={pc.id}
                    className="flex items-center justify-between rounded-md border p-2 text-sm"
                  >
                    <span>
                      {pc.label || "Parked cart"} —{" "}
                      {new Date(pc.updatedAt).toLocaleTimeString()}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void resumeCart(pc.id)}
                    >
                      Resume
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {!online && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Offline cart{" "}
                  {localCart.length > 0
                    ? `(${localCart.reduce((s, l) => s + l.quantity, 0)} items)`
                    : ""}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {localCart.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Offline cart is empty.
                  </p>
                ) : (
                  <>
                    {localCart.map((l) => (
                      <div
                        key={l.itemId}
                        className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate">{l.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            {(Number(l.unitPrice) * l.quantity).toFixed(2)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={`Decrease ${l.productName} quantity`}
                            disabled={l.quantity <= 1}
                            onClick={() =>
                              void updateOfflineQuantity(l, l.quantity - 1)
                            }
                          >
                            −
                          </Button>
                          <span className="min-w-6 text-center">
                            {l.quantity}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={`Increase ${l.productName} quantity`}
                            onClick={() =>
                              void updateOfflineQuantity(l, l.quantity + 1)
                            }
                          >
                            +
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeOfflineItem(l)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-between border-t pt-2 text-sm font-bold">
                      <span>Est. total</span>
                      <span>
                        {localCart
                          .reduce(
                            (s, l) => s + Number(l.unitPrice) * l.quantity,
                            0
                          )
                          .toFixed(2)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Server re-prices at sync (promos/tax/rounding).
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setLocalCart([])
                        void clearOfflineCart().catch(() => undefined)
                      }}
                    >
                      Clear offline cart
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
          {(queued.length > 0 || syncMsg) && online && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>
                    Offline queue{" "}
                    {queued.length > 0 ? `(${queued.length})` : ""}
                  </CardTitle>
                  {queued.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={syncing}
                      onClick={() => void syncOutbox()}
                    >
                      {syncing ? "Syncing…" : "Sync now"}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {queued.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Queue empty.</p>
                ) : (
                  queued.map((q) => (
                    <div
                      key={q.tempId}
                      className="flex items-center justify-between rounded-md border p-2 text-sm"
                    >
                      <span>
                        {q.tempId} ·{" "}
                        {q.lines.reduce((s, l) => s + l.quantity, 0)} item(s) ·{" "}
                        {q.paymentMethod}
                        {q.status && q.status !== "synced" && (
                          <span className="ml-1 text-red-600">
                            ({q.status})
                          </span>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void removeQueuedSale(q.tempId)
                            .then(() => listQueuedSales())
                            .then(setQueued)
                            .catch(() => undefined)
                        }}
                      >
                        Discard
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Checkout</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={checkout} className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm">Payment method: Cash</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cash">Cash received</Label>
                  <Input
                    id="cash"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    required
                    pattern="^\d+(\.\d{1,2})?$"
                  />
                  {cart && (
                    <p className="text-xs text-muted-foreground">
                      ပေးရန်စုစုပေါင်း: {cart.grandTotal}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={
                      online
                        ? !cart || cart.items.length === 0
                        : localCart.length === 0
                    }
                  >
                    {online ? "Complete sale" : "Queue sale (offline)"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog
        open={invoiceOpen}
        onOpenChange={(open) => {
          if (open) setInvoiceOpen(true)
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          showCloseButton={false}
        >
          <DialogHeader className="receipt-print-header">
            <DialogTitle>
              {taxInvoiceMode ? "Tax invoice" : "Sale invoice"}
            </DialogTitle>
            <DialogDescription>
              Sale completed successfully: {invoice?.saleNumber}
            </DialogDescription>
          </DialogHeader>
          {invoice && (
            <div
              id="receipt-print-content"
              className="mx-auto w-full max-w-sm space-y-3 font-mono text-xs"
            >
              <Card>
                <CardContent className="pt-4 font-mono text-xs">
                  <div className="text-center">
                    <p className="text-sm font-bold">SmartRetailAI</p>
                    {invoice.branchName && <p>{invoice.branchName}</p>}
                    {taxInvoiceMode && <p className="font-bold">TAX INVOICE</p>}
                    <p>
                      {taxInvoiceMode && invoice.taxInvoicePrefix
                        ? `${invoice.taxInvoicePrefix}-${invoice.saleNumber}`
                        : invoice.saleNumber}
                    </p>
                    <p>{new Date(invoice.saleDate).toLocaleString()}</p>
                    {taxInvoiceMode && invoice.registrationNo && (
                      <p>Reg. No: {invoice.registrationNo}</p>
                    )}
                  </div>
                  <hr className="my-2 border-dashed" />
                  {invoice.lines.map((line, index) => (
                    <div key={`${line.productName}-${index}`} className="mb-2">
                      <p>{line.productName ?? "item"}</p>
                      <p className="flex justify-between gap-2">
                        <span>
                          {line.quantity} × {line.unitPrice} / unit
                        </span>
                        <span>Line total {line.lineTotal}</span>
                      </p>
                      <p className="text-[10px]">
                        Unit price {line.unitPrice} · Discount {line.discount}
                      </p>
                    </div>
                  ))}
                  <hr className="my-2 border-dashed" />
                  <p className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{invoice.subtotal}</span>
                  </p>
                  <p className="flex justify-between">
                    <span>Discount</span>
                    <span>{invoice.discountAmount}</span>
                  </p>
                  <p className="flex justify-between">
                    <span>Tax</span>
                    <span>{invoice.tax}</span>
                  </p>
                  <p className="flex justify-between">
                    <span>Rounding</span>
                    <span>{invoice.roundingAdjustment}</span>
                  </p>
                  <p className="flex justify-between text-sm font-bold">
                    <span>TOTAL</span>
                    <span>{invoice.grandTotal}</span>
                  </p>
                  <p className="flex justify-between">
                    <span>Paid ({invoice.paymentMethod})</span>
                    <span>
                      {invoice.paymentMethod === "cash"
                        ? (invoice.cashReceived ?? invoice.grandTotal)
                        : invoice.paymentMethod === "card"
                          ? `**** **** **** ${invoice.cardLast4 ?? "----"}`
                          : invoice.paymentMethod === "mobile"
                            ? `${invoice.mobileProvider ?? "mobile"}${invoice.mobileTransactionId ? ` ${invoice.mobileTransactionId}` : ""}`
                            : (invoice.paymentReference ?? invoice.grandTotal)}
                    </span>
                  </p>
                  {invoice.notes && <p className="mt-1">{invoice.notes}</p>}
                  <div className="mt-3 flex flex-col items-center gap-1 text-center">
                    <QRCode value={publicInvoiceUrl} size={104} />
                    <p>Scan for digital invoice</p>
                    <p className="text-[9px] break-all">{publicInvoiceUrl}</p>
                  </div>
                  <p className="mt-2 text-center">Thank you — come again</p>
                </CardContent>
              </Card>
            </div>
          )}
          <DialogFooter className="receipt-print-controls">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTaxInvoiceMode((mode) => !mode)}
            >
              {taxInvoiceMode ? "Receipt view" : "Tax invoice view"}
            </Button>
            {invoice && (
              <a
                className="text-sm underline"
                href={publicInvoiceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open digital invoice
              </a>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setInvoiceOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const printDialog = document.querySelector<HTMLElement>(
                  '[data-slot="dialog-content"]'
                )
                if (printDialog) printDialog.scrollTop = 0
                window.print()
                setInvoiceOpen(false)
              }}
            >
              Print invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
