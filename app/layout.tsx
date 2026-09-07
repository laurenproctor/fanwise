import type { Metadata } from "next"
import { Archivo, Instrument_Sans, JetBrains_Mono } from "next/font/google"
import { StrayFileDropGuard } from "@/components/ui/stray-file-drop-guard"
import "./globals.css"

// Self-hosted at build time by next/font, so there is no render-blocking request
// to fonts.googleapis.com and no layout shift while the faces load.
// Weights follow docs/design-system.md.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["200", "300", "400", "500"],
  variable: "--font-archivo",
  display: "swap",
})

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-instrument-sans",
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Fanwise",
  description: "One catalog. Every channel.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-body antialiased">
        {/*
          Above children, and at the root rather than on the pages that accept
          files. The failure it prevents — a dropped file replacing the
          document — belongs to every page, including the ones with nothing to
          drop onto, where a stray file is pure loss.
        */}
        <StrayFileDropGuard />
        {children}
      </body>
    </html>
  )
}
