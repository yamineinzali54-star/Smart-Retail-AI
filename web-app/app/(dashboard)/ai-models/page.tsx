import { redirect } from "next/navigation";

import { AiModelsSettings } from "@/components/admin/ai-models-settings";
import { PageShell } from "@/components/page-shell";
import { getSession } from "@/lib/auth";

export default async function AiModelsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  return (
    <PageShell
      title="AI model settings"
      subtitle="Manage provider credentials, check account budgets, and choose which models are available in AI Chat."
      allow={["admin"]}
    >
      <AiModelsSettings />
    </PageShell>
  );
}
