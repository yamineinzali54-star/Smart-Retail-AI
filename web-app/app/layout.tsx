import { Geist, JetBrains_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import SessionRefresher from "@/components/session-refresher"
import ServiceWorkerRegister from "@/components/sw-register"
import LanguageProvider from "@/components/language-provider"
import { cn } from "@/lib/utils";

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
})

const jetbrainsMono = JetBrains_Mono({subsets:['latin'],variable:'--font-mono'})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased font-sans", fontSans.variable, jetbrainsMono.variable)}
    >
      <body>
        <ThemeProvider>
          <LanguageProvider>
            <SessionRefresher />
            <ServiceWorkerRegister />
            {children}
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
