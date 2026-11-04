"use client";

import type { ComponentProps, ReactNode } from "react";

import { localizeNode, useI18n } from "@/lib/i18n";

export function LocalizedSelect({
  children,
  ...props
}: ComponentProps<"select"> & { children?: ReactNode }) {
  const { locale } = useI18n();

  return <select {...props}>{localizeNode(locale, children)}</select>;
}
