"use client";

// Registers the offline service worker (§6.8). Mounted once in the root
// layout next to SessionRefresher. No-ops on unsupported browsers.
import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Never let the production offline worker cache Turbopack chunks during
    // development. A stale cached chunk can reference removed client modules.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => void registration.unregister());
      });
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline shell is progressive enhancement — never break the app.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
