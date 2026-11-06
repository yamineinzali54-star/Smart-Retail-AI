import type { MetadataRoute } from "next";

// PWA manifest (§6.8 offline mode) — served at /manifest.webmanifest.
// Allowlisted in proxy.ts (no session required for the browser fetch).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SmartRetailAI POS",
    short_name: "SmartRetailAI",
    description: "Multi-branch-ready retail ERP + POS with offline support",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0D9488",
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
