import { Geist, JetBrains_Mono, Merriweather } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import SessionRefresher from "@/components/session-refresher"
import ServiceWorkerRegister from "@/components/sw-register"
import LanguageProvider from "@/components/language-provider"
import { cn } from "@/lib/utils";

const merriweatherHeading = Merriweather({subsets:['latin'],variable:'--font-heading'});

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
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
      className={cn("antialiased", fontSans.variable, "font-mono", jetbrainsMono.variable, merriweatherHeading.variable)}
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
