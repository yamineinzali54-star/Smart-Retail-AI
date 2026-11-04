"use client";

import { usePageSession } from "@/components/page-shell";
import { RevenueForecastPanel } from "./revenue-forecast-panel";

export default function RevenueForecastingPage() {
  const { session } = usePageSession();
  const isAdmin = session?.user.role === "admin";

  return <RevenueForecastPanel isAdmin={isAdmin} />;
}
