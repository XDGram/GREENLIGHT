import { useEffect, useRef } from "react";

// The hero illustration: a field of dots drawn on a canvas. Two tall arcs frame the page (as in a
// globe seen edge-on) and a large check mark made of dots rises out of the light below the headline.
// Dots twinkle slowly; with reduced motion the picture is drawn once and stays still.

type Dot = { x: number; y: number; r: number; a: number; s: number };

function build(w: number, h: number): Dot[] {
  const dots: Dot[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

  // Side arcs: an ellipse of dots, kept only where it curves at the left and right edges.
  const cx = w / 2;
  const cy = h * 0.56;
  // On narrow screens the arcs would cross the text, so they are left out.
  for (const k of w < 760 ? [] : [0.46, 0.4]) {
    const rx = w * k;
    const ry = h * 0.5;
    for (let t = 0; t < Math.PI * 2; t += 0.035) {
      const c = Math.cos(t);
      if (Math.abs(c) < 0.72) continue;
      const edge = (Math.abs(c) - 0.72) / 0.28;
      dots.push({ x: cx + rx * c, y: cy + ry * Math.sin(t), r: 1 + edge * 1.6, a: 0.25 + edge * 0.6, s: rnd() * 6.28 });
    }
  }

  // The check mark: dots on a grid, brighter near the stroke.
  // Below the headline and buttons, rising out of the light at the bottom.
  const scale = w < 760 ? Math.min(w * 0.56, h * 0.3) : Math.min(w * 0.3, h * 0.36);
  const ox = cx - scale * 0.5;
  const oy = h * (w < 760 ? 0.68 : 0.7);
  const P = [
    [0.0, 0.52],
    [0.36, 0.86],
    [1.0, 0.1],
  ].map(([x, y]) => [ox + x! * scale, oy + y! * scale] as const);
  const dist = (px: number, py: number, a: readonly [number, number], b: readonly [number, number]) => {
    const [ax, ay] = a;
    const [bx, by] = b;
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
  };
  const step = Math.max(6, Math.round(scale / 46));
  const thick = scale * 0.13;
  for (let x = ox - thick; x < ox + scale + thick; x += step) {
    for (let y = oy - thick; y < oy + scale + thick; y += step) {
      const d = Math.min(dist(x, y, P[0]!, P[1]!), dist(x, y, P[1]!, P[2]!));
      const f = 1 - d / (thick * 1.6);
      if (f <= 0 || rnd() > 0.35 + f) continue;
      dots.push({ x: x + (rnd() - 0.5) * 1.5, y: y + (rnd() - 0.5) * 1.5, r: 0.8 + f * 1.9, a: 0.18 + f * 0.82, s: rnd() * 6.28 });
    }
  }

  // A light scatter of stars.
  for (let i = 0; i < 70; i += 1) dots.push({ x: rnd() * w, y: rnd() * h * 0.9, r: 0.6 + rnd() * 0.8, a: 0.12 + rnd() * 0.3, s: rnd() * 6.28 });
  return dots;
}

export function DotField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let dots: Dot[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dots = build(w, h);
      if (still) draw(0);
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        const tw = still ? 1 : 0.72 + 0.28 * Math.sin(t / 900 + d.s);
        ctx.globalAlpha = Math.min(1, d.a * tw);
        // White on the night sky; blue where the background has faded to light.
        const light = d.y > h * 0.8;
        ctx.fillStyle = light ? (d.a > 0.7 ? "#1d4ed8" : "#60a5fa") : d.a > 0.7 ? "#ffffff" : "#bfdbfe";
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
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
  }, []);
  return <canvas ref={ref} className="lp-dots" aria-hidden="true" />;
}
