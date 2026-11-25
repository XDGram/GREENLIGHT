import React, { useContext } from "react";
import { Audio, Img, Sequence, staticFile } from "remotion";
import { clamp01, E, EIO, mix, PreCtx, ramp } from "../lib";
import { FPS } from "../timeline";
import appBoxes from "../../../public/cap/app/boxes.json";
import shopBoxes from "../../../public/cap/shop/boxes.json";

// ------------------------------------------------------------------ look

export const INK = "#0b0c0e";
export const GRAY = "#8a8f98";
export const LINE = "#e6e7ea";
export const SANS = "'Inter', sans-serif";
export const MONO = "'Mono', monospace";

type Box = { x: number; y: number; w: number; h: number };
export const APP = appBoxes as unknown as Record<string, Record<string, Box & { w: number; h: number }>>;
export const SHOP = shopBoxes as unknown as Record<string, Box>;
export const center = (b: Box): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];

// ------------------------------------------------------------------ stage

/** White stage with a soft floor shadow so cards sit on something. */
export function Stage({ children }: { children?: React.ReactNode }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#ffffff", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 80% at 50% 0%, #ffffff 55%, #f2f3f5 100%)" }} />
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ window with a real capture

/** Window geometry on the 1920 × 1080 stage. Pages are captured at 1440 css px wide. */
export const WIN = { x: 240, y: 72, w: 1440, h: 900, chrome: 46 };
export const pageToStage = (px: number, py: number, scroll = 0, win = WIN): [number, number] => [win.x + px, win.y + win.chrome + py - scroll];

export function Window({ src, scroll = 0, url, children, win = WIN, dim = 0 }: { src: string; scroll?: number; url: string; children?: React.ReactNode; win?: typeof WIN; dim?: number }) {
  return (
    <div style={{ position: "absolute", left: win.x, top: win.y, width: win.w, height: win.h + win.chrome, borderRadius: 16, overflow: "hidden", background: "#fff", boxShadow: "0 50px 120px rgba(15,18,25,0.16), 0 14px 36px rgba(15,18,25,0.10), 0 0 0 1px rgba(15,18,25,0.07)" }}>
      <div style={{ height: win.chrome, background: "#f5f5f6", borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center", padding: "0 18px", gap: 8 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 12, background: c }} />
        ))}
        <div style={{ margin: "0 auto", width: 520, height: 28, borderRadius: 8, background: "#fff", border: `1px solid ${LINE}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, font: `500 14px ${SANS}`, color: "#3c4048" }}>
          <svg width="11" height="13" viewBox="0 0 11 13">
            <rect x="0.8" y="5.5" width="9.4" height="6.7" rx="1.6" fill="none" stroke="#8a8f98" strokeWidth="1.4" />
            <path d="M3 5.5V4a2.5 2.5 0 0 1 5 0v1.5" fill="none" stroke="#8a8f98" strokeWidth="1.4" />
          </svg>
          {url}
        </div>
        <span style={{ width: 52 }} />
      </div>
      <div style={{ position: "relative", width: win.w, height: win.h, overflow: "hidden" }}>
        <Img src={staticFile(src)} style={{ position: "absolute", left: 0, top: -scroll, width: win.w, display: "block" }} />
        {children}
        {dim > 0 ? <div style={{ position: "absolute", inset: 0, background: `rgba(255,255,255,${dim})` }} /> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ camera

export type Cam = { x: number; y: number; k: number };
export const OVER: Cam = { x: 960, y: 540, k: 1 };
/** Camera framing a box (stage coordinates) with padding, capped zoom. */
export function frame(b: Box, pad = 120, kmax = 2.6): Cam {
  const k = Math.min(1920 / (b.w + pad * 2), 1080 / (b.h + pad * 2), kmax);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2, k };
}
export const pageBox = (b: Box, scroll = 0, win = WIN): Box => {
  const [x, y] = pageToStage(b.x, b.y, scroll, win);
  return { x, y, w: b.w, h: b.h };
};

/** Camera along keyframes [time, cam]; eased segments. */
export function camAt(t: number, keys: [number, Cam][]): Cam {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, c1] = keys[i];
    const [t0, c0] = keys[i - 1];
    if (t <= t1) {
      const p = EIO(clamp01((t - t0) / Math.max(0.001, t1 - t0)));
      // Zoom in log space so pushes feel even.
      const k = Math.exp(mix(Math.log(c0.k), Math.log(c1.k), p));
      return { x: mix(c0.x, c1.x, p), y: mix(c0.y, c1.y, p), k };
    }
  }
  return keys[keys.length - 1][1];
}

/** Camera layer with motion blur from its own speed (and optional shake). */
export function Camera({ t, keys, children, shake = 0 }: { t: number; keys: [number, Cam][]; children: React.ReactNode; shake?: number }) {
  const c = camAt(t, keys);
  const p = camAt(t - 1 / FPS, keys);
  const speed = Math.hypot((c.x - p.x) * c.k, (c.y - p.y) * c.k) + Math.abs(Math.log(c.k / p.k)) * 900;
  const blur = Math.min(7, Math.max(0, speed - 6) * 0.11);
  const sx = shake * Math.sin(t * 93) * 6;
  const sy = shake * Math.cos(t * 71) * 5;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${960 - c.x * c.k + sx}px, ${540 - c.y * c.k + sy}px) scale(${c.k})`, filter: blur > 0.3 ? `blur(${blur / c.k}px)` : undefined }}>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ pointer

/** macOS-style pointer drawn in stage coordinates (inside the camera, so zooms with the shot). */
export function Pointer({ x, y, down = 0, label, opacity = 1, k = 1 }: { x: number; y: number; down?: number; label?: string; opacity?: number; k?: number }) {
  const s = (1 / Math.sqrt(k)) * (1 - 0.14 * down);
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity, transform: `scale(${s})`, transformOrigin: "0 0", zIndex: 60, pointerEvents: "none" }}>
      <svg width="30" height="40" viewBox="0 0 17 22" style={{ display: "block", filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.28))" }}>
        <path d="M1 1 L1 17.5 L5.2 13.6 L8.1 20.4 L11 19.2 L8.2 12.6 L14 12.6 Z" fill={INK} stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      {label ? <div style={{ position: "absolute", left: 22, top: 30, background: INK, color: "#fff", font: `600 15px ${SANS}`, padding: "6px 11px", borderRadius: 8, whiteSpace: "nowrap", boxShadow: "0 8px 20px rgba(0,0,0,0.25)" }}>{label}</div> : null}
    </div>
  );
}

/** Pointer path over [time, x, y] keyframes (stage coordinates), eased. */
export function along(t: number, k: [number, number, number][]): [number, number] {
  if (t <= k[0][0]) return [k[0][1], k[0][2]];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) {
      const p = EIO(clamp01((t - k[i - 1][0]) / (k[i][0] - k[i - 1][0])));
      // A slight arc, like a hand.
      const bow = Math.sin(p * Math.PI) * Math.min(60, Math.hypot(k[i][1] - k[i - 1][1], k[i][2] - k[i - 1][2]) * 0.08);
      return [mix(k[i - 1][1], k[i][1], p), mix(k[i - 1][2], k[i][2], p) - bow];
    }
  }
  const l = k[k.length - 1];
  return [l[1], l[2]];
}

export const press = (t: number, at: number) => (t < at - 0.07 || t > at + 0.2 ? 0 : t < at ? (t - (at - 0.07)) / 0.07 : 1 - (t - at) / 0.2);

export function ClickRing({ x, y, t, at, k = 1 }: { x: number; y: number; t: number; at: number; k?: number }) {
  const p = clamp01((t - at) / 0.45);
  if (t < at || p >= 1) return null;
  const r = (8 + 30 * E(p)) / Math.sqrt(k);
  return <div style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: "50%", border: `${2 / Math.sqrt(k)}px solid rgba(11,12,14,0.45)`, opacity: 1 - p, zIndex: 59 }} />;
}

// ------------------------------------------------------------------ kinetic type

/**
 * A line of words that resolves word by word out of blur and below the baseline, and leaves upward
 * into blur. `at` per word (seconds) or a start with a stagger. `mark` words get an ink underline.
 */
export function Words({ t, text, at, stagger = 0.08, out, size = 96, weight = 700, color = INK, mark = [], align = "center", gap = 0.24, track = -0.045, dur = 0.55 }: { t: number; text: string; at: number | number[]; stagger?: number; out?: number; size?: number; weight?: number; color?: string; mark?: string[]; align?: "center" | "left"; gap?: number; track?: number; dur?: number }) {
  const words = text.split(" ");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start", columnGap: `${gap}em`, font: `${weight} ${size}px/1.08 ${SANS}`, letterSpacing: `${track}em`, color }}>
      {words.map((w, i) => {
        const a = Array.isArray(at) ? at[i] ?? at[at.length - 1] : at + i * stagger;
        const p = ramp(t, a, a + dur);
        const o = out != null ? ramp(t, out + i * 0.03, out + i * 0.03 + 0.4, EIO) : 0;
        const marked = mark.includes(w.replace(/[.,?!]/g, ""));
        const u = marked ? ramp(t, a + 0.25, a + 0.75) : 0;
        return (
          <span key={i} style={{ position: "relative", display: "inline-block", opacity: p * (1 - o), transform: `translateY(${(1 - p) * 0.38 + -o * 0.3}em) scale(${mix(0.96, 1, p)})`, filter: `blur(${(1 - p) * 14 + o * 12}px)` }}>
            {w}
            {marked ? <span style={{ position: "absolute", left: 0, right: 0, bottom: "-0.06em", height: "0.075em", background: color, transformOrigin: "0 50%", transform: `scaleX(${u})`, borderRadius: 4 }} /> : null}
          </span>
        );
      })}
    </div>
  );
}

/** Word start times spread over a spoken span. */
export const spread = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n));

/** A small ink tag that pops beside something (inside the camera). */
export function Tag({ x, y, t, at, out, text, k = 1, side = "right" }: { x: number; y: number; t: number; at: number; out?: number; text: string; k?: number; side?: "right" | "left" | "top" }) {
  const p = ramp(t, at, at + 0.45);
  const o = out != null ? ramp(t, out, out + 0.3) : 0;
  if (p <= 0 || o >= 1) return null;
  const s = 1 / k;
  return (
    <div style={{ position: "absolute", left: x, top: y, transformOrigin: side === "left" ? "100% 50%" : "0 50%", transform: `translate(${side === "left" ? "-100%" : "0"}, -50%) scale(${s * mix(0.85, 1, E(p))})`, opacity: p * (1 - o), filter: `blur(${(1 - p) * 6}px)`, zIndex: 55 }}>
      <div style={{ background: INK, color: "#fff", font: `600 22px ${SANS}`, letterSpacing: "-0.01em", padding: "10px 18px", borderRadius: 12, whiteSpace: "nowrap", boxShadow: "0 14px 34px rgba(0,0,0,0.22)" }}>{text}</div>
    </div>
  );
}

// ------------------------------------------------------------------ cards

/** A white card that flips in from the side and resolves out of blur. */
export function Card({ t, at, out, x, y, w, h, children, from = 1 }: { t: number; at: number; out?: number; x: number; y: number; w: number; h: number; children: React.ReactNode; from?: number }) {
  const p = ramp(t, at, at + 0.75);
  const o = out != null ? ramp(t, out, out + 0.5, EIO) : 0;
  if (p <= 0) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, perspective: 1600 }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 26, background: "#fff", boxShadow: "0 40px 90px rgba(15,18,25,0.12), 0 10px 26px rgba(15,18,25,0.08), 0 0 0 1px rgba(15,18,25,0.06)", transform: `rotateY(${(1 - E(p)) * -38 * from}deg) translateY(${(1 - E(p)) * 40 - o * 60}px) scale(${mix(0.9, 1, E(p)) * mix(1, 0.92, o)})`, opacity: p * (1 - o), filter: `blur(${(1 - p) * 10 + o * 14}px)`, padding: 40, boxSizing: "border-box", overflow: "hidden" }}>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ sound

export type SfxName = string;
/** A sound at a time (seconds) in the current scene. Kenney (CC0) files use their names, e.g. "kenney/click_002.ogg". */
export function Sfx({ at, src, volume = 0.6 }: { at: number; src: SfxName; volume?: number }) {
  const pre = useContext(PreCtx);
  if (at + pre < 0) return null;
  return (
    <Sequence from={Math.round((at + pre) * FPS)} durationInFrames={FPS * 3} layout="none">
      <Audio src={staticFile(`sfx/${src}`)} volume={volume} />
    </Sequence>
  );
}

export const S = {
  click: "kenney/click_002.ogg",
  key: "kenney/tick_002.ogg",
  toggle: "kenney/switch_002.ogg",
  drop: "kenney/drop_002.ogg",
  copy: "kenney/select_002.ogg",
  error: "kenney/error_006.ogg",
  pass: "kenney/confirmation_002.ogg",
  open: "kenney/maximize_006.ogg",
  close: "kenney/minimize_006.ogg",
  card: "kenney/glass_002.ogg",
  pop: "kenney/pluck_001.ogg",
  whoosh: "whoosh.wav",
  swish: "swish.wav",
  riser: "riser.wav",
};

/** Key clicks while typing: one every few characters. */
export function Keys({ start, n, cps }: { start: number; n: number; cps: number }) {
  return (
    <>
      {Array.from({ length: Math.floor(n / 2) }, (_, i) => (
        <Sfx key={i} at={start + (i * 2) / cps} src={S.key} volume={0.22} />
      ))}
    </>
  );
}

/** Image for typed text: the last captured step at or below the typed length. */
export function stepImage(prefix: string, steps: number[], typed: number, before: string) {
  let pick = before;
  for (const s of steps) if (typed >= s) pick = `${prefix}${String(s).padStart(2, "0")}.jpg`;
  return pick;
}
