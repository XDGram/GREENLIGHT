import { useEffect, useRef } from "react";

// A rotating globe of dots (continents are where a smooth noise field is high) with two large dot
// arcs framing the sides, projected in 3D on a canvas. Dots facing the viewer are bright, the far
// side is faint; below `lightFrom` (where the background turns light) dots are drawn in blue.

type P = { x: number; y: number; z: number; land: boolean };

function fib(n: number): P[] {
  const pts: P[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = g * i;
    const x = Math.cos(t) * r;
    const z = Math.sin(t) * r;
    const lat = Math.asin(y);
    const lon = Math.atan2(z, x);
    const noise = Math.sin(lon * 2.1 + 0.6) * Math.cos(lat * 3.2 - 0.4) + 0.55 * Math.sin(lon * 5.3 + lat * 2.7) + 0.3 * Math.cos(lon * 9.1 - lat * 6.3);
    pts.push({ x, y, z, land: noise > 0.15 });
  }
  return pts;
}

export function GlobeField({ center = 0.8, size = 0.3, arcs = true, lightFrom = 0.86, clearAbove = 0.62, className = "lp-dots" }: { center?: number; size?: number; arcs?: boolean; lightFrom?: number; clearAbove?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const sphere = fib(6400);
    let w = 0;
    let h = 0;
    let raf = 0;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const narrow = w < 760;
      const R = Math.min(w * (narrow ? 0.46 : 0.26), h * size);
      const cx = w / 2;
      const cy = h * center;
      const rot = still ? 0.6 : t / 9000;
      const tilt = -0.32;
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      for (const p of sphere) {
        // rotate around Y, then tilt around X
        const x1 = p.x * cr - p.z * sr;
        const z1 = p.x * sr + p.z * cr;
        const y2 = p.y * ct - z1 * st;
        const z2 = p.y * st + z1 * ct;
        if (z2 < -0.15 && !p.land) continue;
        const sx = cx + x1 * R;
        const sy = cy - y2 * R;
        const front = (z2 + 1) / 2; // 0 back .. 1 front
        const a = p.land ? 0.15 + front * 0.85 : 0.05 + front * 0.2;
        const r = p.land ? 0.7 + front * 1.5 : 0.6 + front * 0.6;
        const light = sy > h * lightFrom;
        // Keep the text area clear: dots fade in below `clearAbove`.
        const clear = Math.max(0, Math.min(1, (sy - h * clearAbove) / (h * 0.08), (h - sy) / (h * 0.1)));
        if (clear <= 0) continue;
        ctx.globalAlpha = a * clear;
        ctx.fillStyle = light ? (p.land ? "#1d4ed8" : "#60a5fa") : p.land && front > 0.7 ? "#ffffff" : "#bcd4ff";
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (arcs && !narrow) {
        // Two large arcs of dots at the edges, slowly breathing.
        const ay = h * 0.55;
        for (const [k, side] of [
          [0.47, 1],
          [0.41, 1],
          [0.47, -1],
          [0.41, -1],
        ] as const) {
          const rx = w * k;
          const ry = h * 0.52;
          for (let a = -Math.PI / 2; a <= Math.PI / 2; a += 0.028) {
            const c = Math.cos(a);
            const edge = Math.pow(c, 3);
            const sx = w / 2 + side * rx * (0.94 + 0.06 * c);
            const sy = ay + ry * Math.sin(a);
            const pulse = still ? 1 : 0.7 + 0.3 * Math.sin(t / 1300 + a * 4 + k * 10);
            ctx.globalAlpha = (0.18 + edge * 0.7) * pulse;
            ctx.fillStyle = sy > h * lightFrom ? "#3b82f6" : "#dbe7ff";
            ctx.beginPath();
            ctx.arc(sx, sy, 0.9 + edge * 1.6, 0, Math.PI * 2);
            ctx.fill();
          }
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
    const loop = (t: number) => {
      draw(t);
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
  }, [center, size, arcs, lightFrom, clearAbove]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

/** A sparse scatter of pixels that fades out downwards, as at the top of the reference's sections. */
export function PixelScatter({ tone = "blue", className = "lp-scatter" }: { tone?: "blue" | "white"; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      let seed = 17;
      const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
      const cell = 7;
      for (let y = 0; y < h; y += cell) {
        const fade = 1 - y / h;
        for (let x = 0; x < w; x += cell) {
          const band = 0.5 + 0.5 * Math.sin(x / 140 + y / 60);
          if (rnd() > fade * fade * 0.22 * (0.4 + band)) continue;
          ctx.globalAlpha = 0.15 + fade * 0.55 * rnd();
          ctx.fillStyle = tone === "white" ? "#dbe7ff" : rnd() > 0.85 ? "#1d4ed8" : "#60a5fa";
          ctx.fillRect(x, y, 3, 3);
        }
      }
      ctx.globalAlpha = 1;
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [tone]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
