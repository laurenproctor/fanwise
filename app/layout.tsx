import type { Metadata } from "next"
import { Archivo, Instrument_Sans, JetBrains_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { StrayFileDropGuard } from "@/components/ui/stray-file-drop-guard"
import { AnimatedFavicon } from "@/components/ui/animated-favicon"
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
  // The mark, as static files in public/ rather than the app/icon.* file
  // convention: the animated favicon swaps between frame files at the same
  // path, and a build-generated route would put the resting icon somewhere the
  // frames are not. The colour is the mark's own field, not a palette token,
  // because a mask-icon colour and a manifest theme are pixels, not CSS.
  icons: {
    icon: [
      { url: "/fanwise-favicon/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    other: [{ rel: "mask-icon", url: "/safari-pinned-tab.svg", color: "#050B1B" }],
  },
  manifest: "/site.webmanifest",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/*
          The theme initialiser, before first paint. Same-origin rather than
          inline so it runs under a script policy with no nonce in it; the
          reason is in public/theme.js and lib/security/headers.ts.

          Synchronous on purpose, which is what the disabled rule objects to.
          The rule guards page speed; this script exists to run before the
          first paint so the page never flashes the wrong theme, and next/script
          with `beforeInteractive` renders only a preload in the static HTML and
          injects the tag from the client runtime, after that paint. The file is
          a few hundred bytes, same-origin and cached.
        */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme.js" />
      </head>
      <body className="font-body antialiased">
        {/*
          Above children, and at the root rather than on the pages that accept
          files. The failure it prevents — a dropped file replacing the
          document — belongs to every page, including the ones with nothing to
          drop onto, where a stray file is pure loss.
        */}
        <StrayFileDropGuard />
        {/*
          Renders null and owns one <link rel="icon"> it appends itself. Here
          rather than on a page because the opening fan is once per load of
          the application, and the root layout is the one thing a client-side
          route change never remounts.
        */}
        <AnimatedFavicon />
        {children}
        {/*
          Renders null and appends a same-origin script, /_vercel/insights/script.js,
          so the nonce policy in lib/security/headers.ts admits it under 'self' with
          no nonce to thread through. Its own Suspense boundary keeps the
          useSearchParams read from opting a page out of prerendering. It only
          reports from a Vercel deployment; a local build appends nothing.
        */}
        <Analytics />
      </body>
    </html>
  )
}
