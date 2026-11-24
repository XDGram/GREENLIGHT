import { useEffect, useRef } from "react";

// Greenlight's signature backdrop: a 3D field of dots rolling like a signal, seen in perspective,
// with a few lime "green lights" blinking on across it. Used on the landing page and behind every
// app page. Still (one frame) when the viewer prefers reduced motion.

export function DotWave({
  horizon = 0.45,
  amplitude = 1,
  tone = "night",
  className = "dotwave",
  fixed = false,
}: {
  /** Where the far edge of the field sits, as a fraction of the canvas height. */
  horizon?: number;
  amplitude?: number;
  /** "night": white and sky-blue dots on a dark sky; "day": blue dots on a light background. */
  tone?: "night" | "day";
  className?: string;
  /** Fixed to the viewport (app backdrop) instead of filling its parent. */
  fixed?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let w = 0;
    let h = 0;
    let raf = 0;
    let seed = 41;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    // Which grid points are "green lights", and their blink phase.
    const lights = new Map<number, number>();
    const COLS = 70;
    const ROWS = 34;
    for (let i = 0; i < 90; i += 1) lights.set(Math.floor(rnd() * COLS * ROWS), rnd() * 6.28);

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const hy = h * horizon;
      const spanX = Math.max(w, 900) * 1.5;
      const time = still ? 0 : t / 1000;
      for (let r = ROWS - 1; r >= 0; r -= 1) {
        const z = r / (ROWS - 1); // 0 near .. 1 far
        const persp = 1 / (1 + z * 3.2);
        const rowY = hy + (h - hy) * Math.pow(1 - z, 1.6) * 1.05;
        for (let c = 0; c < COLS; c += 1) {
          const u = c / (COLS - 1) - 0.5;
          const wave = Math.sin(u * 7 + time * 0.9 + z * 4) * Math.cos(z * 6 - time * 0.6) + 0.45 * Math.sin(u * 15 - time * 1.3 + z * 9);
          const lift = wave * 46 * amplitude * persp * (0.6 + 0.4 * (1 - z));
          const x = w / 2 + u * spanX * persp;
          const y = rowY - lift;
          if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
          const near = 1 - z;
          const idx = r * COLS + c;
          const phase = lights.get(idx);
          const crest = Math.max(0, wave);
          let alpha = (0.12 + near * 0.55) * (0.65 + 0.35 * crest);
          let size = 0.6 + near * 1.9 + crest * 0.5;
          let color = tone === "night" ? (crest > 0.6 ? "#ffffff" : "#9cc2ff") : crest > 0.6 ? "#1d4ed8" : "#5b8def";
          if (phase !== undefined) {
            const on = still ? 1 : Math.max(0, Math.sin(time * 1.4 + phase));
            if (on > 0.05) {
              color = "#d9f24a";
              alpha = Math.min(1, 0.35 + on * 0.75);
              size += 1.2 * on;
              ctx.globalAlpha = alpha * 0.25;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(x, y, size * 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(0);
    };
    // Pause when the tab is hidden; keep ~30 fps to stay light.
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 33) {
        draw(t);
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    if (!still) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [horizon, amplitude, tone]);
  return <canvas ref={ref} className={`${className} ${fixed ? "is-fixed" : ""}`} aria-hidden="true" />;
}
