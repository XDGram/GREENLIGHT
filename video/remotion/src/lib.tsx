import React, { createContext, useContext } from "react";
import { Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { FPS } from "./timeline";

/** One easing for the whole film: quick out, soft landing. */
export const E = Easing.bezier(0.22, 1, 0.36, 1);
/** For camera moves that start and end at rest. */
export const EIO = Easing.bezier(0.65, 0, 0.35, 1);

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const ramp = (t: number, a: number, b: number, ease = E) => (b <= a ? (t >= a ? 1 : 0) : ease(clamp01((t - a) / (b - a))));
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** Seconds before the scene's own start covered by a fade-in (set by the scene runner). */
export const PreCtx = createContext(0);

/** Seconds since the scene's start (negative during its fade-in over the scene before). */
export function useT() {
  const f = useCurrentFrame();
  const pre = useContext(PreCtx);
  return f / FPS - pre;
}

/** Value along keyframes [[time, value], ...] with eased segments. */
export function keys(t: number, k: [number, number][], ease = EIO) {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) return mix(k[i - 1][1], k[i][1], ease(clamp01((t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]))));
  }
  return k[k.length - 1][1];
}

/** A point along keyframes [[time, x, y], ...]. */
export function path(t: number, k: [number, number, number][], ease = EIO): [number, number] {
  return [keys(t, k.map((p) => [p[0], p[1]] as [number, number]), ease), keys(t, k.map((p) => [p[0], p[2]] as [number, number]), ease)];
}

/** The part of `text` typed by time t, starting at `start`, at `cps` characters per second. */
export const typed = (text: string, t: number, start: number, cps = 22) => text.slice(0, Math.max(0, Math.floor((t - start) * cps)));

/** Camera over a 1920 × 1080 world: the world point (x, y) sits at the screen centre, scaled by k. */
export const camera = (x: number, y: number, k: number): React.CSSProperties => ({
  position: "absolute",
  left: 0,
  top: 0,
  width: 1920,
  height: 1080,
  transformOrigin: "0 0",
  transform: `translate(${960 - x * k}px, ${540 - y * k}px) scale(${k})`,
});

/** A short sound at a time (seconds) in the current scene. */
export function Sfx({ at, name, volume = 0.5 }: { at: number; name: "click" | "type" | "tick" | "fail" | "pass"; volume?: number }) {
  const pre = useContext(PreCtx);
  return (
    <Sequence from={Math.round((at + pre) * FPS)} durationInFrames={FPS * 2} layout="none">
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
    </Sequence>
  );
}

/** Soft key clicks while text is typed: one every few characters. */
export function Typing({ start, text, cps = 22, volume = 0.18 }: { start: number; text: string; cps?: number; volume?: number }) {
  const n = Math.floor(text.length / 3);
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <Sfx key={i} at={start + (i * 3) / cps} name="type" volume={volume} />
      ))}
    </>
  );
}

/** A pointer. `down` (0..1) is the press. `label` tags it, like a shared cursor. */
export function Cursor({ x, y, down = 0, label, opacity = 1, scale = 1 }: { x: number; y: number; down?: number; label?: string; opacity?: number; scale?: number }) {
  const s = scale * (1 - 0.12 * down);
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity, transform: `scale(${s})`, transformOrigin: "0 0", zIndex: 50, pointerEvents: "none" }}>
      <svg width="34" height="44" viewBox="0 0 17 22" style={{ display: "block", filter: "drop-shadow(0 3px 6px rgba(10,20,40,0.35))" }}>
        <path d="M1 1 L1 17.5 L5.2 13.6 L8.1 20.4 L11 19.2 L8.2 12.6 L14 12.6 Z" fill="#fff" stroke="#141a22" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      {label ? (
        <div style={{ position: "absolute", left: 26, top: 34, background: "#141a22", color: "#fff", font: "600 17px 'Jakarta'", padding: "5px 11px", borderRadius: 8, whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(10,20,40,0.25)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 8, background: "#22b36b" }} />
          {label}
        </div>
      ) : null}
    </div>
  );
}

/** A press curve around a click time: 0 → 1 → 0 over ~0.25 s. */
export const press = (t: number, at: number) => (t < at - 0.08 || t > at + 0.22 ? 0 : t < at ? (t - (at - 0.08)) / 0.08 : 1 - (t - at) / 0.22);

/** A soft ripple ring at a click. */
export function Ripple({ x, y, t, at, color = "rgba(20,26,34,0.35)" }: { x: number; y: number; t: number; at: number; color?: string }) {
  const p = clamp01((t - at) / 0.5);
  if (t < at || p >= 1) return null;
  const r = 10 + 34 * E(p);
  return <div style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: "50%", border: `2px solid ${color}`, opacity: 1 - p, zIndex: 49 }} />;
}
