import { useEffect, useRef } from 'react'

/**
 * A scrolling level meter like ChatGPT's dictation strip: a new bar every
 * ~70ms, height from the live mic level, flat dots when silent.
 */
export function Waveform({ level, active }: { level: () => number; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')!
    const bars: number[] = []
    let raf = 0
    let last = 0
    let peak = 0

    const draw = (t: number) => {
      const dpr = window.devicePixelRatio || 1
      const w = el.clientWidth
      const h = el.clientHeight
      if (el.width !== w * dpr || el.height !== h * dpr) {
        el.width = w * dpr
        el.height = h * dpr
      }
      peak = Math.max(peak, active ? level() : 0)
      if (t - last > 70) {
        bars.push(peak)
        peak = 0
        last = t
      }
      const gap = 3
      const bw = 3
      const max = Math.floor(w / (bw + gap))
      while (bars.length > max) bars.shift()

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = getComputedStyle(el).color
      // Newest bar on the right, history scrolling left.
      for (let i = 0; i < bars.length; i++) {
        const x = w - (bars.length - i) * (bw + gap)
        const bh = Math.max(bw, Math.min(h, bars[i] * h * 1.4))
        const y = (h - bh) / 2
        ctx.beginPath()
        ctx.roundRect(x, y, bw, bh, bw / 2)
        ctx.fill()
      }
      // Dotted guide for the part of the strip that has no history yet.
      ctx.globalAlpha = 0.35
      for (let x = w - bars.length * (bw + gap) - (bw + gap); x > 0; x -= bw + gap) {
        ctx.beginPath()
        ctx.roundRect(x, (h - bw) / 2, bw, bw, bw / 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [level, active])

  return <canvas ref={canvas} className="waveform" aria-hidden />
}
