"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import Script from "next/script"
import { gaMeasurementId, trackPageView } from "@/lib/analytics/ga"

/**
 * Loads gtag.js and sends one page view per route. Renders nothing without
 * NEXT_PUBLIC_GA_MEASUREMENT_ID. The script tag carries no inline code, so the
 * nonce policy admits it by host (lib/security/headers.ts) and the root layout
 * never has to read a request header, which would opt every page out of
 * prerendering. lib/analytics/ga.ts holds the rules on what is sent.
 */
export function GoogleAnalytics() {
  const id = gaMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID)
  const pathname = usePathname()

  useEffect(() => {
    if (id) trackPageView()
  }, [id, pathname])

  if (!id) return null
  return (
    <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
  )
}
