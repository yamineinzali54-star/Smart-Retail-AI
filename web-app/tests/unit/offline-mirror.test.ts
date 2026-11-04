import { describe, expect, it } from "vitest";

import {
  parseMirror,
  serializeMirror,
  type QueuedSale,
} from "@/lib/offline-queue";

function sale(tempId: string): QueuedSale {
  return {
    tempId,
    createdAt: "2026-10-14T00:00:00.000Z",
    posSessionId: null,
    lines: [{ productId: "p1", itemId: "i1", quantity: 2 }],
    paymentMethod: "cash",
    cashReceived: "1000",
  };
}

describe("offline mirror serialization", () => {
  it("round-trips queued sales", () => {
    const sales = [sale("OFF-A"), sale("OFF-B")];
    expect(parseMirror(serializeMirror(sales))).toEqual(sales);
  });

  it("caps the snapshot at 200 entries (newest kept)", () => {
    const sales = Array.from({ length: 250 }, (_, i) => sale(`OFF-${i}`));
    const parsed = parseMirror(serializeMirror(sales));
    expect(parsed).toHaveLength(200);
    expect(parsed[0].tempId).toBe("OFF-50");
    expect(parsed[199].tempId).toBe("OFF-249");
  });

  it("returns [] for null, garbage, non-arrays", () => {
    expect(parseMirror(null)).toEqual([]);
    expect(parseMirror("")).toEqual([]);
    expect(parseMirror("{bad json")).toEqual([]);
    expect(parseMirror('{"not":"array"}')).toEqual([]);
  });

  it("drops malformed entries but keeps valid ones", () => {
    const raw = JSON.stringify([
      sale("OFF-OK"),
      { tempId: 123, lines: [] },
      { lines: [] },
      { tempId: "OFF-NOLINES" },
      null,
      "string",
    ]);
    expect(parseMirror(raw)).toEqual([sale("OFF-OK")]);
  });
});
