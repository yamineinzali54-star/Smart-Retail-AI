"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { RiGlobalLine } from "@remixicon/react";

import {
  detectLocale,
  I18nContext,
  persistLocale,
  translate,
  useI18n,
  type I18nKey,
  type Locale,
} from "@/lib/i18n";

export default function LanguageProvider({ children }: { children: ReactNode }) {
  // Keep the server render and the first client render deterministic. The
  // persisted locale is applied after hydration to avoid English/Myanmar
  // navigation text mismatches.
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    void Promise.resolve().then(() => setLocaleState(detectLocale()));
  }, []);

  const setLocale = useCallback((l: Locale) => {
    persistLocale(l);
    setLocaleState(l);
  }, []);

  const t = useCallback((key: I18nKey) => translate(locale, key), [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="flex items-center gap-1 text-sm">
      <RiGlobalLine className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="rounded-md border border-input bg-background px-1 py-1 text-sm"
        aria-label={t("common.language")}
      >
        <option value="en">EN</option>
        <option value="my">MM</option>
      </select>
    </label>
  );
}
