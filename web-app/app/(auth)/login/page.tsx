import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <main className="relative flex min-h-svh w-full items-center justify-center overflow-hidden bg-background px-6 py-12 md:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,#06B6D426,transparent_44%),radial-gradient(circle_at_bottom_left,#0D948822,transparent_46%)]" />
      <div className="relative w-full max-w-md">
        <Suspense fallback={<p className="text-center text-sm text-muted-foreground">Loading…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
