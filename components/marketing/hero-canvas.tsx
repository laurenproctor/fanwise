"use client"

import { useEffect, useRef } from "react"

/**
 * One point of light fanning into six labeled beams — the mark, animated.
 *
 * A direct port of `componentDidMount` in the handoff's landing file. The whole
 * frame is redrawn each tick rather than composited, which is what makes the
 * additive `lighter` blending look right: the beams have to accumulate against a
 * clean gradient every time, not against the last frame.
 *
 * Under `prefers-reduced-motion: reduce` it draws one static frame and never
 * schedules another, so the beams sit at full brightness instead of pulsing.
 */
const SHOPS = ["ETSY", "CREATIVE MARKET", "ENVATO", "GUMROAD", "ADOBE STOCK", "MYFONTS"]

// Six passes per beam, widest first, to build a soft core rather than a hard line.
const BEAM_WIDTHS = [1, 3, 8, 18, 36, 64]

export function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let width = 0
    let height = 0
    let dpr = 1
    let time = 0
    let raf = 0

    function size() {
      if (!canvas || !ctx) return
      const rect = canvas.getBoundingClientRect()
      // Capped at 2: past that the extra pixels cost more than they show.
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function draw() {
      if (!ctx || !width || !height) return

      const gradient = ctx.createLinearGradient(0, 0, width * 0.9, height)
      gradient.addColorStop(0, "#04060D")
      gradient.addColorStop(0.55, "#060B18")
      gradient.addColorStop(1, "#0A1230")
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)

      // Below 860px the origin moves left and the fan opens wider, because a
      // centered fan on a phone puts every label off the right edge.
      const narrow = width < 860
      const px = narrow ? width * 0.16 : width * 0.42
      const py = narrow ? height * 0.72 : height * 0.68
      const reach = narrow ? width * 1.05 : width * 0.62
      const spread = narrow ? 48 : 40
      const n = SHOPS.length

      ctx.globalCompositeOperation = "lighter"

      // Three faint arcs, suggesting distance the beams travel through.
      for (let o = 0; o < 3; o++) {
        const rx = reach * (0.3 + o * 0.24)
        const ry = rx * (narrow ? 0.72 : 0.56)
        ctx.beginPath()
        ctx.ellipse(px + rx * 0.62, py, rx * 0.66, ry, 0, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(150,185,255,${0.09 - o * 0.022})`
        ctx.lineWidth = 1
        ctx.stroke()
      }

      SHOPS.forEach((shop, i) => {
        const f = i / (n - 1)
        const angle = ((-spread + f * spread * 2) * Math.PI) / 180
        const pulse = reduce ? 1 : 0.82 + 0.18 * Math.sin(time / 1000 + i * 1.1)
        const ex = px + Math.cos(angle) * reach
        const ey = py + Math.sin(angle) * reach

        const beam = ctx.createLinearGradient(px, py, ex, ey)
        beam.addColorStop(0, `rgba(255,255,255,${0.55 * pulse})`)
        beam.addColorStop(0.16, `rgba(190,220,255,${0.3 * pulse})`)
        beam.addColorStop(0.55, `rgba(90,140,255,${0.13 * pulse})`)
        beam.addColorStop(1, "rgba(50,90,220,0)")

        BEAM_WIDTHS.forEach((lineWidth, w) => {
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(ex, ey)
          ctx.strokeStyle = beam
          ctx.globalAlpha = (0.9 / (w + 1)) * 0.5
          ctx.lineWidth = lineWidth
          ctx.lineCap = "round"
          ctx.stroke()
        })
        ctx.globalAlpha = 1

        // Labels are dropped on narrow screens, where they would overlap.
        if (!narrow) {
          const lx = px + Math.cos(angle) * reach * 0.66
          const ly = py + Math.sin(angle) * reach * 0.66
          ctx.save()
          ctx.translate(lx, ly)
          ctx.rotate(angle)
          // Text is drawn normally: additive blending would wash it out.
          ctx.globalCompositeOperation = "source-over"
          ctx.font = '500 10px "JetBrains Mono", monospace'
          ctx.fillStyle = "rgba(196,214,255,0.62)"
          ctx.textAlign = "left"
          ctx.textBaseline = "middle"
          ctx.letterSpacing = "2px"
          ctx.fillText(shop, 14, -8)
          ctx.restore()
          ctx.globalCompositeOperation = "lighter"
        }
      })

      const bloomR = narrow ? 120 : 190
      const bloom = ctx.createRadialGradient(px, py, 0, px, py, bloomR)
      bloom.addColorStop(0, "rgba(255,255,255,0.95)")
      bloom.addColorStop(0.06, "rgba(214,232,255,0.55)")
      bloom.addColorStop(0.3, "rgba(96,145,255,0.20)")
      bloom.addColorStop(1, "rgba(40,80,200,0)")
      ctx.fillStyle = bloom
      ctx.beginPath()
      ctx.arc(px, py, bloomR, 0, Math.PI * 2)
      ctx.fill()

      ctx.globalCompositeOperation = "source-over"
      ctx.beginPath()
      ctx.arc(px, py, 13, 0, Math.PI * 2)
      ctx.strokeStyle = "rgba(190,215,255,0.55)"
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(px, py, 3.2, 0, Math.PI * 2)
      ctx.fillStyle = "#fff"
      ctx.fill()

      if (!narrow) {
        ctx.font = '500 10px "JetBrains Mono", monospace'
        ctx.fillStyle = "rgba(160,182,225,0.75)"
        ctx.textAlign = "center"
        ctx.textBaseline = "top"
        ctx.letterSpacing = "2px"
        ctx.fillText("ONE MASTER LISTING", px, py + 30)
        ctx.beginPath()
        ctx.moveTo(px, py + 14)
        ctx.lineTo(px, py + 24)
        ctx.strokeStyle = "rgba(160,182,225,0.5)"
        ctx.stroke()
      }

      // Ninety single pixels on an irrational stride, so the field reads as dust
      // rather than as a grid.
      ctx.globalAlpha = 0.05
      for (let s = 0; s < 90; s++) {
        ctx.fillStyle = "#cfe0ff"
        ctx.fillRect((s * 137.5) % width, (s * 311.7) % height, 1, 1)
      }
      ctx.globalAlpha = 1
    }

    function frame(now: number) {
      time = now || 0
      if (!width || !height) size()
      draw()
      if (!reduce) raf = requestAnimationFrame(frame)
    }

    function onResize() {
      size()
      draw()
    }

    window.addEventListener("resize", onResize)
    const observer = new ResizeObserver(onResize)
    observer.observe(canvas)

    size()
    draw()
    if (!reduce) raf = requestAnimationFrame(frame)

    // The labels are set in JetBrains Mono; drawn before the face loads they are
    // measured and positioned as the fallback and never corrected.
    if (document.fonts?.ready) void document.fonts.ready.then(draw)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener("resize", onResize)
      observer.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-label="A single point of light fanning out into six beams, one for each marketplace"
      className="fw-hero__canvas"
    />
  )
}
