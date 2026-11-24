import { useEffect, useRef, type ReactNode } from "react";

// Workspace page furniture: the night-blue hero band every app page opens with (pixel art that is
// different per page), and the pixel badge that identifies an app.

export type PixelVariant = "scan" | "verdict" | "waves";
export type PixelTone = "blue" | "pass" | "fail" | "warn";

const TONES: Record<PixelTone, [string, string]> = {
  blue: ["#bfdbfe", "#ffffff"],
  pass: ["#86efac", "#d9f24a"],
  fail: ["#fca5a5", "#fecaca"],
  warn: ["#fcd34d", "#fde68a"],
};

type Dot = { x: number; y: number; r: number; a: number; k: number; hi?: boolean };

function seeded(seed: number) {
  let x = seed;
  return () => (x = (x * 9301 + 49297) % 233280) / 233280;
}

/** The dots of one picture, laid out in the band's right-hand area (w x h). */
function layout(variant: PixelVariant, w: number, h: number): Dot[] {
  const rnd = seeded(variant === "scan" ? 3 : variant === "verdict" ? 11 : 29);
  const dots: Dot[] = [];
  const step = 9;
  // A faint field of dots across the whole band.
  for (let x = 6; x < w; x += step * 2) for (let y = 6; y < h; y += step * 2) if (rnd() < 0.18) dots.push({ x, y, r: 0.9, a: 0.12 + rnd() * 0.12, k: rnd() * 6.28 });
  // The picture sits right of the text column; on narrow screens only the faint field remains.
  if (w < 760) return dots;
  const right = Math.max(w * 0.58, (w - 1180) / 2 + 700);
  const area = Math.min(w - right - 40, 460);
  if (variant === "scan") {
    // A browser window drawn in dots, with text lines and a button inside.
    const bw = Math.min(area, 380);
    const bh = Math.min(h - 50, 190);
    const ox = right + (area - bw) / 2;
    const oy = (h - bh) / 2 + 6;
    for (let x = 0; x <= bw; x += step) {
      dots.push({ x: ox + x, y: oy, r: 1.5, a: 0.75, k: x });
      dots.push({ x: ox + x, y: oy + 22, r: 1.1, a: 0.45, k: x });
      dots.push({ x: ox + x, y: oy + bh, r: 1.5, a: 0.75, k: x });
    }
    for (let y = 0; y <= bh; y += step) {
      dots.push({ x: ox, y: oy + y, r: 1.5, a: 0.75, k: y });
      dots.push({ x: ox + bw, y: oy + y, r: 1.5, a: 0.75, k: y });
    }
    for (const [i, len] of [0.55, 0.8, 0.68, 0.4].entries()) for (let x = 18; x < bw * len; x += step) dots.push({ x: ox + x, y: oy + 48 + i * 22, r: 1.3, a: 0.4 + rnd() * 0.2, k: x });
    for (let x = bw - 120; x < bw - 20; x += 7) for (let y = bh - 42; y < bh - 18; y += 7) dots.push({ x: ox + x, y: oy + y, r: 1.6, a: 0.85, k: x, hi: true });
  } else if (variant === "verdict") {
    // Concentric rings of dots around a bright core.
    const cx = right + area / 2;
    const cy = h / 2 + 4;
    const maxR = Math.min(area / 2, h / 2 - 16);
    for (let ring = 1; ring <= 6; ring += 1) {
      const r = (ring / 6) * maxR;
      const n = Math.round((2 * Math.PI * r) / step);
      for (let i = 0; i < n; i += 1) {
        const t = (i / n) * Math.PI * 2;
        dots.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), r: 2.2 - ring * 0.22, a: 0.95 - ring * 0.12, k: ring + t, hi: ring <= 2 });
      }
    }
  } else {
    // Layered waves of dots, like a stack of results over time.
    for (let layer = 0; layer < 5; layer += 1) {
      for (let x = right; x < w - 20; x += step) {
        const y = h * 0.28 + layer * 26 + Math.sin(x / 46 + layer * 0.8) * 14;
        dots.push({ x, y, r: 1.6 - layer * 0.15, a: 0.85 - layer * 0.14, k: x / 30 + layer, hi: layer === 0 });
      }
    }
  }
  return dots;
}

/** Canvas pixel art for the hero band. Animates gently; still with reduced motion. */
function PixelArt({ variant, tone }: { variant: PixelVariant; tone: PixelTone }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const [base, hi] = TONES[tone];
    let dots: Dot[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const sweep = variant === "scan" ? ((t / 2600) % 1) * w : 0;
      for (const d of dots) {
        let a = d.a;
        if (!still) {
          if (variant === "scan" && d.x > w * 0.5) a *= 0.55 + 0.45 * Math.max(0, 1 - Math.abs(d.x - sweep) / 70) + 0.25;
          else if (variant === "verdict") a *= 0.65 + 0.35 * Math.sin(t / 700 - d.k * 0.9);
          else a *= 0.7 + 0.3 * Math.sin(t / 900 + d.k);
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
        ctx.fillStyle = d.hi ? hi : base;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
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
      dots = layout(variant, w, h);
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
  }, [variant, tone]);
  return <canvas ref={ref} className="ws-hero-art" aria-hidden="true" />;
}

/** The night-blue band at the top of each app page. */
export function PageHero({ variant, tone = "blue", back, title, children, aside }: { variant: PixelVariant; tone?: PixelTone; back?: ReactNode; title: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="ws-hero">
      <PixelArt variant={variant} tone={tone} />
      <div className="ws-hero-in">
        {back ?? null}
        <div className="ws-hero-text">
          {title}
          {children}
          {aside ? <div className="ws-hero-aside">{aside}</div> : null}
        </div>
      </div>
    </section>
  );
}

/** "xdgram/watchdog" -> { owner: "xdgram", name: "watchdog", title: "Watchdog" } */
export function appIdentity(repository: string | null | undefined, url: string, fallback: string) {
  const m = /github\.com\/([^/]+)\/([^/#?]+)/i.exec(repository ?? "") ?? /^([^/\s]+)\/([^/\s]+)$/.exec(fallback);
  const owner = m?.[1] ?? null;
  const name = (m?.[2] ?? new URL(url).hostname.split(".")[0] ?? fallback).replace(/\.git$/, "");
  const title = name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { owner, name, title, host: new URL(url).host };
}

/** A 5x5 mirrored pixel badge derived from the app's name: every app gets its own mark. */
export function AppBadge({ seed, size = 44 }: { seed: string; size?: number }) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const hue = h % 360;
  const cells: boolean[] = [];
  for (let i = 0; i < 15; i += 1) cells.push(((h >>> i) & 1) === 1 || i === 7);
  const on = (x: number, y: number) => cells[y * 3 + (x < 3 ? x : 4 - x)]!;
  return (
    <span className="ws-badge-art" style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 70% 22%), hsl(${(hue + 40) % 360} 75% 38%))` }} aria-hidden="true">
      <svg viewBox="0 0 5 5" width={size * 0.56} height={size * 0.56} shapeRendering="crispEdges">
        {Array.from({ length: 25 }, (_, i) => {
          const x = i % 5;
          const y = Math.floor(i / 5);
          return on(x, y) ? <rect key={i} x={x + 0.08} y={y + 0.08} width="0.84" height="0.84" rx="0.18" fill={i % 3 === 0 ? "#d9f24a" : "#ffffff"} /> : null;
        })}
      </svg>
    </span>
  );
}
