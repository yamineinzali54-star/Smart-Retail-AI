"use client";

// Auth-aware fetch wrapper for client components.
// On 401 it attempts exactly one refresh-token rotation, then retries the
// original request once. Returns the (possibly retried) response as-is.
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 401) return first;

  const url = typeof input === "string" ? input : input.toString();
  // Never loop the refresh endpoint through itself.
  if (url.includes("/api/auth/refresh") || url.includes("/api/auth/login")) {
    return first;
  }

  try {
    const refresh = await fetch("/api/auth/refresh", { method: "POST" });
    if (!refresh.ok) return first;
  } catch {
    return first;
  }
  return fetch(input, init);
}
