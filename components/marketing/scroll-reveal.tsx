"use client"

import { useEffect } from "react"

/**
 * Sections fade and rise as they enter the viewport.
 *
 * Ported from design/handoff/marketing-site/reveal.js. Two things about it are
 * load-bearing rather than decorative:
 *
 * Nothing is hidden until the observer is actually installed. The design script
 * sets opacity to 0 in the same pass that starts observing, so a page whose
 * JavaScript never runs is fully readable — the content is not styled invisible
 * by the stylesheet and then rescued.
 *
 * Under `prefers-reduced-motion: reduce` it returns before touching anything, so
 * there is no transform and no transition to suppress.
 */
export function ScrollReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const seen = new WeakSet<Element>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          const el = entry.target as HTMLElement
          el.style.opacity = "1"
          el.style.transform = "none"
        }
      },
      { threshold: 0.06, rootMargin: "0px 0px -40px 0px" },
    )

    function prep(el: HTMLElement, delay: number) {
      if (seen.has(el)) return
      seen.add(el)
      el.style.opacity = "0"
      el.style.transform = "translateY(26px)"
      el.style.transition =
        `opacity .7s cubic-bezier(.2,.6,.2,1) ${delay}ms, ` +
        `transform .7s cubic-bezier(.2,.6,.2,1) ${delay}ms`
      observer.observe(el)
    }

    function scan() {
      const els = document.body.querySelectorAll<HTMLElement>("section, article, header, footer")
      // Four per stagger group, so a grid of siblings arrives as a wave rather
      // than one element every 90ms down a long page.
      els.forEach((el, i) => prep(el, (i % 4) * 90))
    }

    scan()
    const mutations = new MutationObserver(scan)
    mutations.observe(document.body, { childList: true, subtree: true })

    return () => {
      mutations.disconnect()
      observer.disconnect()
    }
  }, [])

  return null
}
