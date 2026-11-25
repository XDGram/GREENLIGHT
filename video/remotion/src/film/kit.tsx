import React, { createContext, useContext } from "react";
import { AbsoluteFill, Audio, Easing, Sequence, staticFile, useCurrentFrame } from "remotion";
import { FPS } from "../timeline";

// The motion kit for the film: one camera that pushes in on every click, a cursor that glides,
// kinetic type for the voiceover, impacts, shockwaves and scene transitions.

export const SANS = "'Jakarta', system-ui, sans-serif";
export const MONO = "'Mono', ui-monospace, monospace";

/** Expo out: fast, then a long soft landing. The film's main ease. */
export const OUT = Easing.bezier(0.16, 1, 0.3, 1);
/** In-out for camera travel between two resting points. */
export const IO = Easing.bezier(0.7, 0, 0.2, 1);
/** A small overshoot, for things that land with weight. */
export const BACK = Easing.bezier(0.34, 1.45, 0.64, 1);
export const IN = Easing.bezier(0.6, 0, 0.9, 0.4);

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
export const ramp = (t: number, a: number, b: number, ease: (x: number) => number = OUT) => (b <= a ? (t >= a ? 1 : 0) : ease(clamp01((t - a) / (b - a))));
/** 0 → 1 → 0: rises over `up`, holds, falls over `down`. */
export const pulse = (t: number, a: number, b: number, up = 0.35, down = 0.35) => Math.min(ramp(t, a, a + up), 1 - ramp(t, b - down, b, IN));

// ------------------------------------------------------------------ scene time

export const SceneCtx = createContext({ pre: 0, dur: 10 });
/** Seconds since the scene's start (negative during the overlap with the scene before). */
export function useT() {
  const f = useCurrentFrame();
  const { pre } = useContext(SceneCtx);
  return f / FPS - pre;
}

// ------------------------------------------------------------------ camera

export type Shot = [t: number, x: number, y: number, zoom: number];

/** Camera at time t over keyframed shots. Each move takes `travel` seconds, eased in-out. */
export function camAt(t: number, shots: Shot[], travel = 0.9): { x: number; y: number; k: number } {
  let cur = { x: shots[0][1], y: shots[0][2], k: shots[0][3] };
  for (let i = 1; i < shots.length; i++) {
    const [at, x, y, k] = shots[i];
    const p = ramp(t, at, at + travel, IO);
    if (p <= 0) break;
    cur = { x: mix(cur.x, x, p), y: mix(cur.y, y, p), k: mix(cur.k, k, p) };
  }
  return cur;
}

/**
 * The world (a 1920 × 1080 stage) seen through a camera. The camera eases between shots;
 * fast moves pick up a little blur, the way a real lens smears a whip.
 */
export function Camera({ shots, travel = 0.9, shake = 0, glitch = 0, punch = 0, children }: { shots: Shot[]; travel?: number; shake?: number; glitch?: number; punch?: number; children: React.ReactNode }) {
  const t = useT();
  const c = camAt(t, shots, travel);
  const p = camAt(t - 1 / FPS, shots, travel);
  const speed = Math.hypot(c.x - p.x, c.y - p.y) * c.k + Math.abs(c.k - p.k) * 900;
  const blur = Math.min(7, Math.max(0, (speed - 6) / 9));
  const sx = shake ? Math.sin(t * 91) * shake : 0;
  const sy = shake ? Math.cos(t * 77) * shake : 0;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1920,
          height: 1080,
          transformOrigin: "0 0",
          transform: `translate(${960 - c.x * c.k * (1 + punch) + sx}px, ${540 - c.y * c.k * (1 + punch) + sy}px) scale(${c.k * (1 + punch)})`,
          filter: [blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : "", glitch > 0.02 ? `drop-shadow(${(glitch * 14).toFixed(1)}px 0 0 rgba(255,40,80,0.75)) drop-shadow(${(-glitch * 14).toFixed(1)}px 0 0 rgba(40,220,255,0.75))` : ""].join(" ").trim() || undefined,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}

/** Screen shake that decays after an impact at time `at`. */
export const shakeAt = (t: number, at: number, amp = 14, len = 0.45) => (t < at || t > at + len ? 0 : amp * (1 - (t - at) / len) ** 2);

// ------------------------------------------------------------------ cursor

export type CursorKey = [t: number, x: number, y: number];

/** Cursor position along keys, gliding with an in-out ease (a smoothed, human path). */
export function cursorAt(t: number, keys: CursorKey[], travel = 0.7): [number, number] {
  let x = keys[0][1];
  let y = keys[0][2];
  for (let i = 1; i < keys.length; i++) {
    const [at, nx, ny] = keys[i];
    const p = ramp(t, at - travel, at, IO);
    if (p <= 0) break;
    // A slight arc, like a wrist.
    const arc = Math.sin(p * Math.PI) * Math.min(40, Math.hypot(nx - x, ny - y) * 0.08);
    x = mix(x, nx, p);
    y = mix(y, ny, p) - arc;
  }
  return [x, y];
}

export const press = (t: number, at: number) => (t < at - 0.07 || t > at + 0.2 ? 0 : t < at ? (t - (at - 0.07)) / 0.07 : 1 - (t - at) / 0.2);

export function Cursor({ x, y, down = 0, label, opacity = 1, scale = 1 }: { x: number; y: number; down?: number; label?: string; opacity?: number; scale?: number }) {
  const s = scale * (1 - 0.16 * down);
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity, transform: `scale(${s})`, transformOrigin: "0 0", zIndex: 60, pointerEvents: "none" }}>
      <svg width="30" height="38" viewBox="0 0 17 22" style={{ display: "block", filter: "drop-shadow(0 4px 8px rgba(5,10,25,0.45))" }}>
        <path d="M1 1 L1 17.5 L5.2 13.6 L8.1 20.4 L11 19.2 L8.2 12.6 L14 12.6 Z" fill="#fff" stroke="#0b0f17" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      {label ? (
        <div style={{ position: "absolute", left: 22, top: 30, background: "#2ee68a", color: "#04130b", font: `700 15px ${SANS}`, padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap", boxShadow: "0 6px 16px rgba(46,230,138,0.35)" }}>{label}</div>
      ) : null}
    </div>
  );
}

/** Click feedback: a filled pop and an expanding ring. */
export function Click({ x, y, t, at, color = "#2ee68a", size = 1 }: { x: number; y: number; t: number; at: number; color?: string; size?: number }) {
  const p = clamp01((t - at) / 0.55);
  if (t < at || p >= 1) return null;
  const r = (12 + 46 * OUT(p)) * size;
  const r2 = (8 + 22 * OUT(p)) * size;
  return (
    <>
      <div style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: "50%", border: `${3 * (1 - p) + 1}px solid ${color}`, opacity: 1 - p, zIndex: 59 }} />
      <div style={{ position: "absolute", left: x - r2, top: y - r2, width: r2 * 2, height: r2 * 2, borderRadius: "50%", background: color, opacity: 0.35 * (1 - p), zIndex: 59 }} />
    </>
  );
}

// ------------------------------------------------------------------ kinetic type

/**
 * A line of words that snap up out of a mask, one by one: crisp edges, no blur, a fast expo
 * settle. Highlighted words (`hl`) get a solid marker bar that sweeps in behind them, with the
 * word knocked out in ink. `out` sends the line up and away. Plays a swish as it lands.
 */
export function Words({
  text,
  t,
  at,
  out = 999,
  per = 0.06,
  size = 96,
  weight = 800,
  color = "#fff",
  hl = {},
  align = "center",
  lh = 1.08,
  ls = -0.045,
  style,
  sound = true,
}: {
  text: string;
  t: number;
  at: number;
  out?: number;
  per?: number;
  size?: number;
  weight?: number;
  color?: string;
  hl?: Record<string, string>;
  align?: "center" | "left";
  lh?: number;
  ls?: number;
  style?: React.CSSProperties;
  sound?: boolean;
}) {
  const words = text.split(" ");
  return (
    <>
      <div style={{ font: `${weight} ${size}px/${lh} ${SANS}`, letterSpacing: `${ls}em`, color, textAlign: align, display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start", columnGap: `${size * 0.25}px`, ...style }}>
        {words.map((w, i) => {
          const a = at + i * per;
          const pin = ramp(t, a, a + 0.42);
          const pout = ramp(t, out + i * 0.03, out + i * 0.03 + 0.3, IN);
          const key = w.replace(/[^\w']/g, "");
          const mark = hl[key];
          const bar = mark ? ramp(t, a + 0.18, a + 0.5) : 0;
          return (
            <span key={i} style={{ position: "relative", display: "inline-block", overflow: "hidden", padding: `0.02em ${mark ? "0.12em" : "0.02em"} ${size * 0.1}px`, marginBottom: -size * 0.1 }}>
              {mark ? <span style={{ position: "absolute", left: 0, right: 0, top: "8%", bottom: `${(size * 0.1) / 2}px`, background: mark, borderRadius: size * 0.08, transform: `scaleX(${bar * (1 - pout)})`, transformOrigin: "left center" }} /> : null}
              <span
                style={{
                  position: "relative",
                  display: "inline-block",
                  color: mark && bar > 0.5 ? "#04130b" : color,
                  transform: `translateY(${(1 - pin) * 110 - pout * 115}%)`,
                }}
              >
                {w}
              </span>
            </span>
          );
        })}
      </div>
      {sound ? <Sfx at={at} name="swish" volume={0.28} /> : null}
    </>
  );
}

/** One big line that punches in from scale with a hard landing and a hit. */
export function Slam({ text, t, at, size = 220, color = "#fff", out = 999, glow }: { text: string; t: number; at: number; size?: number; color?: string; out?: number; glow?: string }) {
  const p = ramp(t, at, at + 0.28, OUT);
  const o = 1 - ramp(t, out, out + 0.3, IN);
  return (
    <>
      {t >= at ? (
        <div
          style={{
            font: `800 ${size}px/1 ${SANS}`,
            letterSpacing: `${mix(0.08, -0.055, p)}em`,
            color,
            transform: `scale(${mix(1.9, 1, p) + (1 - o) * 0.25})`,
            opacity: Math.min(1, p * 3) * o,
            textShadow: glow ? `0 0 70px ${glow}` : undefined,
            whiteSpace: "nowrap",
          }}
        >
          {text}
        </div>
      ) : null}
      <Sfx at={at} name="hit" volume={0.7} />
    </>
  );
}

/** A small pill label that pops in (e.g. "No account"). */
export function Tag({ text, t, at, out = 999, color = "#2ee68a", ink = "#04130b", size = 30 }: { text: string; t: number; at: number; out?: number; color?: string; ink?: string; size?: number }) {
  const p = ramp(t, at, at + 0.5, BACK);
  const o = 1 - ramp(t, out, out + 0.3, IN);
  return (
    <>
    <Sfx at={at} name="pop" volume={0.35} />
    {t < at ? null : <span style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: `${size * 0.38}px ${size * 0.8}px`, borderRadius: 999, background: color, color: ink, font: `800 ${size}px ${SANS}`, letterSpacing: "-0.02em", transform: `scale(${mix(0.4, 1, p)})`, opacity: clamp01(p * 1.5) * o, boxShadow: `0 14px 40px ${color}55` }}>
      {text}
    </span>}
    </>
  );
}

// ------------------------------------------------------------------ explosive effects

/** Concentric shockwave rings from a point. */
export function Shockwave({ x, y, t, at, color = "#2ee68a", max = 1400, rings = 3 }: { x: number; y: number; t: number; at: number; color?: string; max?: number; rings?: number }) {
  if (t < at || t > at + 1.4) return null;
  return (
    <>
      {Array.from({ length: rings }, (_, i) => {
        const p = clamp01((t - at - i * 0.09) / 0.9);
        if (p <= 0 || p >= 1) return null;
        const r = 20 + max * OUT(p) * (1 - i * 0.18);
        return <div key={i} style={{ position: "absolute", left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: "50%", border: `${(1 - p) * 10 + 1}px solid ${color}`, opacity: (1 - p) * (1 - i * 0.25), pointerEvents: "none", zIndex: 70 }} />;
      })}
    </>
  );
}

/** A white flash that blooms and fades. */
export function Flash({ t, at, len = 0.45, color = "#fff", max = 0.85 }: { t: number; at: number; len?: number; color?: string; max?: number }) {
  if (t < at || t > at + len) return null;
  const p = (t - at) / len;
  return <AbsoluteFill style={{ background: color, opacity: max * (1 - p) ** 1.6, zIndex: 80, pointerEvents: "none" }} />;
}

/** Radial light streaks bursting from a point (a speed-lines burst, not particles). */
export function Burst({ x, y, t, at, color = "#2ee68a", n = 24, len = 0.7, reach = 900 }: { x: number; y: number; t: number; at: number; color?: string; n?: number; len?: number; reach?: number }) {
  if (t < at || t > at + len) return null;
  const p = (t - at) / len;
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, zIndex: 71, pointerEvents: "none" }}>
      {Array.from({ length: n }, (_, i) => {
        const ang = (i / n) * Math.PI * 2 + (i % 2) * 0.09;
        const r0 = 40 + reach * OUT(p) * (0.6 + 0.4 * ((i * 37) % 10) / 10);
        const r1 = r0 + 140 * (1 - p);
        return <line key={i} x1={x + Math.cos(ang) * r0} y1={y + Math.sin(ang) * r0} x2={x + Math.cos(ang) * r1} y2={y + Math.sin(ang) * r1} stroke={color} strokeWidth={(1 - p) * 6 + 1} strokeLinecap="round" opacity={1 - p} />;
      })}
    </svg>
  );
}

// ------------------------------------------------------------------ scene shell and transitions

export type In = { kind: "burst"; x: number; y: number; color?: string } | { kind: "zoom" } | { kind: "whip"; dir?: 1 | -1 } | { kind: "rise" } | { kind: "cut" };
export type Out = { kind: "through"; x?: number; y?: number } | { kind: "whip"; dir?: 1 | -1 } | { kind: "drop" } | { kind: "hold" };

/**
 * Wraps a scene: plays its entrance over the overlap with the scene before, and its exit over
 * the last `pre` seconds of its own length (where the next scene is entering on top).
 */
export function Shell({ enter, exit, pre, dur, nextPre, children }: { enter: In; exit: Out; pre: number; dur: number; nextPre: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const t = f / FPS - pre;
  const pin = pre > 0 ? clamp01((t + pre) / pre) : 1;
  const ein = OUT(pin);
  const pout = nextPre > 0 ? clamp01((t - (dur - nextPre)) / nextPre) : 0;
  const eout = IN(pout);
  let style: React.CSSProperties = {};
  let clip: string | undefined;
  if (enter.kind === "burst" && pin < 1) clip = `circle(${(ein * 2300).toFixed(1)}px at ${enter.x}px ${enter.y}px)`;
  if (enter.kind === "zoom" && pin < 1) style = { transform: `scale(${mix(0.72, 1, ein)})`, filter: `blur(${(1 - ein) * 24}px)`, opacity: clamp01(pin * 2) };
  if (enter.kind === "whip" && pin < 1) style = { transform: `translateX(${(1 - ein) * 100 * (enter.dir ?? 1)}%)`, filter: `blur(${(1 - ein) * 30}px)` };
  if (enter.kind === "rise" && pin < 1) style = { transform: `translateY(${(1 - ein) * 100}%)`, filter: `blur(${(1 - ein) * 18}px)` };
  if (pout > 0) {
    if (exit.kind === "through") style = { ...style, transform: `scale(${1 + eout * 2.4})`, transformOrigin: `${exit.x ?? 960}px ${exit.y ?? 540}px`, filter: `blur(${eout * 26}px)`, opacity: 1 - eout };
    if (exit.kind === "whip") style = { ...style, transform: `translateX(${-eout * 100 * (exit.dir ?? 1)}%)`, filter: `blur(${eout * 30}px)` };
    if (exit.kind === "drop") style = { ...style, transform: `scale(${1 - eout * 0.12})`, filter: `blur(${eout * 12}px)`, opacity: 1 - eout * 0.6 };
  }
  return (
    <SceneCtx.Provider value={{ pre, dur }}>
      <AbsoluteFill style={{ ...style, clipPath: clip, WebkitClipPath: clip }}>{children}</AbsoluteFill>
    </SceneCtx.Provider>
  );
}

// ------------------------------------------------------------------ sound

export type SfxName = "click" | "type" | "tick" | "fail" | "pass" | "impact" | "whoosh" | "riser" | "pop" | "swish" | "hit" | "sub" | "glitch" | "data" | "boom";
export function Sfx({ at, name, volume = 0.5 }: { at: number; name: SfxName; volume?: number }) {
  const { pre } = useContext(SceneCtx);
  const from = Math.round((at + pre) * FPS);
  if (from < 0) return null;
  return (
    <Sequence from={from} durationInFrames={FPS * 2} layout="none">
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
    </Sequence>
  );
}

/** Soft key clicks while text is typed. */
export function Typing({ start, text, cps = 24, volume = 0.16 }: { start: number; text: string; cps?: number; volume?: number }) {
  const n = Math.floor(text.length / 3);
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <Sfx key={i} at={start + (i * 3) / cps} name="type" volume={volume} />
      ))}
    </>
  );
}

export const typed = (text: string, t: number, start: number, cps = 24) => text.slice(0, Math.max(0, Math.floor((t - start) * cps)));


/** A glitch envelope: a hard on, a few flickers, off within `len` seconds. */
export const glitchAt = (t: number, at: number, len = 0.35) => (t < at || t > at + len ? 0 : (1 - (t - at) / len) * (Math.sin((t - at) * 90) > -0.2 ? 1 : 0.2));
/** A quick zoom punch (0 → amp → 0) at time `at`, for beats. */
export const punchAt = (t: number, at: number, amp = 0.035, len = 0.4) => (t < at || t > at + len ? 0 : amp * Math.sin(Math.PI * clamp01((t - at) / len)) * (1 - (t - at) / len));

/** A diagonal light sweep across a region (a glint). */
export function Sweep({ t, at, x = 0, y = 0, w = 1920, h = 1080, len = 0.8, alpha = 0.5 }: { t: number; at: number; x?: number; y?: number; w?: number; h?: number; len?: number; alpha?: number }) {
  if (t < at || t > at + len) return null;
  const p = OUT((t - at) / len);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, overflow: "hidden", pointerEvents: "none", zIndex: 65, borderRadius: 22 }}>
      <div style={{ position: "absolute", top: -h, bottom: -h, width: 260, left: mix(-400, w + 200, p), transform: "rotate(18deg)", background: `linear-gradient(90deg, transparent, rgba(255,255,255,${alpha}), transparent)` }} />
    </div>
  );
}

/** Chapter label: a number, a line drawing out, and the name, top left. Ticks as it lands. */
export function Chapter({ n, name, t, at = 0.15, out = 2.6, dark = true }: { n: string; name: string; t: number; at?: number; out?: number; dark?: boolean }) {
  const p = ramp(t, at, at + 0.5);
  const o = 1 - ramp(t, out, out + 0.4, IN);
  const ink = dark ? "#ffffff" : "#ffffff";
  return (
    <>
      <div style={{ position: "absolute", left: 70, top: 56, display: "flex", alignItems: "center", gap: 16, opacity: o, zIndex: 90, font: `600 18px ${MONO}`, letterSpacing: "0.18em", color: ink, textTransform: "uppercase" }}>
        <span style={{ opacity: clamp01(p * 2), color: "#2ee68a" }}>{n}</span>
        <span style={{ width: 70 * p, height: 1.5, background: ink, opacity: 0.6 }} />
        <span style={{ overflow: "hidden", display: "inline-block" }}>
          <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 110}%)` }}>{name}</span>
        </span>
      </div>
      <Sfx at={at} name="data" volume={0.22} />
    </>
  );
}
