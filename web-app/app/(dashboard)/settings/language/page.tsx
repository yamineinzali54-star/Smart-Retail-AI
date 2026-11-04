"use client";

import { LanguageToggle } from "@/components/language-provider";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LanguagePage() {
  return (
    <PageShell title="Language" subtitle="English / မြန်မာ — preference persists per device">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Display language</CardTitle>
        </CardHeader>
        <CardContent>
          <LanguageToggle />
          <p className="mt-2 text-sm text-muted-foreground">
            Navigation and common actions translate immediately; full-page coverage grows with each release.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
