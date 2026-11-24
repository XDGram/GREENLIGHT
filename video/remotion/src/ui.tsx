import React from "react";
import { Img, staticFile } from "remotion";
import { clamp01, E, mix, ramp } from "./lib";

export const C = {
  ink: "#141a22",
  ink2: "#2c3542",
  muted: "#5f6b7a",
  faint: "#9aa5b3",
  line: "#e3e9f1",
  lineStrong: "#cfd8e4",
  panel2: "#f2f5f9",
  pass: "#14794a",
  passDot: "#22b36b",
  passBg: "#e8f7ef",
  fail: "#b8321c",
  failDot: "#ef5a3c",
  failBg: "#fdece7",
  blueInk: "#1d5fc4",
  sky: "#2f6fd1",
  lamp: "#7ef0a8",
};
export const SANS = "'Jakarta', sans-serif";
export const MONO = "'Mono', monospace";
export const SITE = "'Liberation Sans', Arial, sans-serif";

let ctx: CanvasRenderingContext2D | null = null;
/** Text width in px for a CSS font string (fonts are loaded before the first frame). */
export function measure(text: string, font: string) {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  ctx!.font = font;
  return ctx!.measureText(text).width;
}

// ------------------------------------------------------------------ sky

/** The app's day sky: blue gradient and slow clouds. `drift` is seconds, for movement. */
export function Sky({ drift = 0, clouds = true, bank = false, bankOpacity = 0.95 }: { drift?: number; clouds?: boolean; bank?: boolean; bankOpacity?: number }) {
  const c = (src: string, x: number, y: number, w: number, speed: number, o = 1) => (
    <Img src={staticFile(`img/${src}`)} style={{ position: "absolute", left: x + drift * speed, top: y, width: w, opacity: o }} />
  );
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(180deg, #3b84e0 0%, #5c9be8 48%, #93c0f0 100%)" }}>
      {clouds ? (
        <>
          {c("cloud-one4.png", 1440, 70, 300, 2.2, 0.95)}
          {c("cloud-one9.png", -40, 420, 260, 1.6, 0.9)}
          {c("cloud-one2.png", 1600, 640, 230, -1.4, 0.9)}
          {c("cloud-one4.png", 640, -40, 180, 1.1, 0.75)}
        </>
      ) : null}
      {bank ? <Img src={staticFile("img/cloud-bank.png")} style={{ position: "absolute", left: -120 + drift * 1.5, bottom: -170, width: 2200, opacity: bankOpacity }} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ brand

/**
 * The Greenlight mark (24-unit grid): a dark tile, a check drawn in dots rising to a green light.
 * draw: 0..1 how many check dots are lit; tile: 0..1 tile scale; lamp: 0..1 light.
 */
export function Mark({ size, draw = 1, tile = 1, lamp = 1, glow = 1 }: { size: number; draw?: number; tile?: number; lamp?: number; glow?: number }) {
  const dots: [number, number, number][] = [
    [4.1, 13.9, 1.45],
    [7.9, 17.6, 1.52],
    [11.6, 13.9, 1.58],
    [15.4, 10.1, 1.64],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", overflow: "visible" }}>
      <g transform={`translate(19.1 6.4) scale(${tile}) translate(-19.1 -6.4)`}>
        <rect width="24" height="24" rx="5.6" fill={C.ink} opacity={clamp01(tile * 3)} />
      </g>
      {dots.map(([x, y, r], i) => {
        const p = clamp01(draw * 4 - (3 - i));
        return <circle key={i} cx={x} cy={y} r={r * E(p)} fill="#fff" opacity={p} />;
      })}
      <circle cx="19.1" cy="6.4" r={3.6 * lamp} fill={C.lamp} fillOpacity={0.28 * glow} />
      <circle cx="19.1" cy="6.4" r={2 * lamp} fill={C.passDot} />
      <circle cx="18.5" cy="5.8" r={0.55 * lamp} fill="#fff" fillOpacity="0.75" />
    </svg>
  );
}

/** The outlined "Greenlight" wordmark (Plus Jakarta Sans Bold), white or ink. Height in px; width follows. */
export function Wordmark({ height, tone = "white", reveal = 1 }: { height: number; tone?: "white" | "ink"; reveal?: number }) {
  const w = (height * 4925) / 1100;
  return (
    <div style={{ width: w, height, overflow: "hidden", clipPath: `inset(0 ${100 - reveal * 100}% 0 0)` }}>
      <Img src={staticFile(`img/wordmark-${tone}.svg`)} style={{ width: w, height, display: "block" }} />
    </div>
  );
}

// ------------------------------------------------------------------ app chrome

export function Nav({ active = "New check", opacity = 1 }: { active?: string; opacity?: number }) {
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 92, borderBottom: "1px solid rgba(255,255,255,0.28)", background: "rgba(255,255,255,0.06)", opacity }}>
      <div style={{ position: "absolute", left: 210, top: 24, display: "flex", alignItems: "center", gap: 14 }}>
        <Mark size={44} />
        <Wordmark height={30} />
      </div>
      <div style={{ position: "absolute", left: 560, top: 22, display: "flex", gap: 10, font: `500 22px ${SANS}` }}>
        {["New check", "My checks", "Account"].map((n) => (
          <div key={n} style={{ padding: "10px 20px", borderRadius: 12, color: n === active ? C.blueInk : "rgba(255,255,255,0.92)", background: n === active ? "#fff" : "transparent" }}>
            {n}
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", right: 210, top: 30, font: `600 21px ${SANS}`, color: "#fff" }}>Ada Okafor</div>
    </div>
  );
}

/** The frosted outer card with an optional header strip, holding a white inner card. */
export function Panel({ x, y, w, h, top, right, children, glow = 0 }: { x: number; y: number; w: number; h: number; top?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; glow?: number }) {
  const strip = top ? 52 : 0;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 30, background: "rgba(255,255,255,0.2)", border: "1.5px solid rgba(255,255,255,0.5)", boxShadow: `0 20px 50px rgba(20,50,100,0.16), 0 0 0 ${4 * glow}px rgba(255,255,255,${0.55 * glow})` }}>
      {top ? (
        <div style={{ position: "absolute", left: 26, right: 26, top: 14, display: "flex", justifyContent: "space-between", font: `500 21px ${SANS}`, color: "#fff" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 18, height: 18, borderRadius: 18, border: "3px solid rgba(255,255,255,0.9)" }} />
            {top}
          </span>
          <span>{right}</span>
        </div>
      ) : null}
      <div style={{ position: "absolute", left: 7, right: 7, top: 7 + strip, bottom: 7, borderRadius: 24, background: "#fff", boxShadow: "0 10px 30px rgba(30,60,90,0.1)", overflow: "hidden" }}>{children}</div>
    </div>
  );
}

export function Badge({ kind, p = 1 }: { kind: "pass" | "fail"; p?: number }) {
  const pass = kind === "pass";
  return (
    <span style={{ display: "inline-block", padding: "6px 14px", borderRadius: 10, font: `600 19px ${SANS}`, color: pass ? C.pass : C.fail, background: pass ? C.passBg : C.failBg, opacity: p, transform: `scale(${mix(0.85, 1, E(p))})` }}>
      {pass ? "Passed" : "Failed"}
    </span>
  );
}

/** The check/minus box at the start of a claim row. kind null = pending. */
export function Tick({ kind, p = 1 }: { kind: "pass" | "fail" | null; p?: number }) {
  const bg = kind === "pass" ? C.passDot : kind === "fail" ? C.failDot : "#fff";
  return (
    <span style={{ position: "relative", width: 34, height: 34, borderRadius: 9, flex: "none", border: `2px solid ${kind ? bg : C.lineStrong}`, background: kind ? bg : "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", transform: `scale(${kind ? mix(0.8, 1, E(p)) : 1})` }}>
      {kind === "pass" ? (
        <svg width="20" height="20" viewBox="0 0 20 20">
          <path d="M4 10.5 L8.3 14.5 L16 6" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="20" strokeDashoffset={20 * (1 - p)} />
        </svg>
      ) : kind === "fail" ? (
        <span style={{ width: 16 * p, height: 3, borderRadius: 2, background: "#fff" }} />
      ) : null}
    </span>
  );
}

// ------------------------------------------------------------------ Kane board

const TRACES: [string, string][] = [
  ["M100 100 H200 V210 H326", "#9900ff"],
  ["M80 180 H180 V230 H326", "#00ccff"],
  ["M60 260 H150 V250 H326", "#ffea00"],
  ["M100 350 H200 V270 H326", "#00ff15"],
  ["M700 90 H560 V210 H474", "#00ccff"],
  ["M740 160 H580 V230 H474", "#00ff15"],
  ["M720 250 H590 V250 H474", "#ff3300"],
  ["M680 340 H570 V270 H474", "#ffea00"],
];
const ENDS: [number, number][] = [
  [100, 100],
  [80, 180],
  [60, 260],
  [100, 350],
  [700, 90],
  [740, 160],
  [720, 250],
  [680, 340],
];
const flowEase = (x: number) => {
  // cubic-bezier(0.5, 0, 0.9, 1) as in the original loader, solved numerically.
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    const bx = 3 * 0.5 * m * (1 - m) ** 2 + 3 * 0.9 * m * m * (1 - m) + m ** 3;
    if (bx < x) lo = m;
    else hi = m;
  }
  const m = (lo + hi) / 2;
  return 3 * 1 * m * m * (1 - m) + m ** 3;
};

/**
 * The circuit-board loader (after Vosoone's "Circuit Board Loader", Uiverse.io, MIT) with KANE CLI
 * on the chip. Driven by time so every frame renders the same way. Drawn in an 800 × 500 box.
 */
export function Circuit({ t, draw = 1, flow = 1, label = "KANE CLI" }: { t: number; draw?: number; flow?: number; label?: string }) {
  const cycle = ((t % 3) + 3) % 3 / 3;
  const off = 438 * (1 - flowEase(cycle));
  return (
    <svg viewBox="0 0 800 500" width="100%" height="100%" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id="kc-chip" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2d2d2d" />
          <stop offset="100%" stopColor="#0f0f0f" />
        </linearGradient>
        <linearGradient id="kc-text" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eeeeee" />
          <stop offset="100%" stopColor="#888888" />
        </linearGradient>
        <linearGradient id="kc-pin" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%" stopColor="#bbbbbb" />
          <stop offset="50%" stopColor="#888888" />
          <stop offset="100%" stopColor="#555555" />
        </linearGradient>
      </defs>
      {TRACES.map(([d, col], i) => (
        <g key={i}>
          <path d={d} fill="none" stroke="#3a3f47" strokeWidth="1.8" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - clamp01(draw * 1.4 - i * 0.05)} />
          <path d={d} fill="none" stroke={col} strokeWidth="1.8" strokeDasharray="40 400" strokeDashoffset={off} opacity={flow * clamp01(draw * 2 - 1)} style={{ filter: `drop-shadow(0 0 6px ${col})` }} />
        </g>
      ))}
      <g opacity={clamp01(draw * 2 - 0.4)}>
        <rect x="330" y="190" width="140" height="100" rx="20" fill="url(#kc-chip)" stroke="#222" strokeWidth="3" />
        {[205, 225, 245, 265].map((y) => (
          <g key={y}>
            <rect x="322" y={y} width="8" height="10" fill="url(#kc-pin)" rx="2" />
            <rect x="470" y={y} width="8" height="10" fill="url(#kc-pin)" rx="2" />
          </g>
        ))}
        <text x="400" y="241" fill="url(#kc-text)" textAnchor="middle" dominantBaseline="middle" style={{ font: "bold 22px Arial, sans-serif", letterSpacing: 1 }}>
          {label}
        </text>
      </g>
      {ENDS.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5" fill="#000" stroke="#3a3f47" strokeWidth="1" opacity={clamp01(draw * 3)} />
      ))}
    </svg>
  );
}

/** Dark stage behind the Kane board, with the live readout. */
export function Board({ t, draw = 1, hud = 1, timer = 0, veil = 0, children }: { t: number; draw?: number; hud?: number; timer?: number; veil?: number; children?: React.ReactNode }) {
  const s = Math.max(0, Math.floor(timer));
  return (
    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 50% 48%, #1a2230 0%, #0b0f15 72%)" }}>
      <div style={{ position: "absolute", inset: 0, background: "#11161e", opacity: veil }} />
      <div style={{ position: "absolute", left: 160, top: 40, width: 1600, height: 1000 }}>
        <Circuit t={t} draw={draw} />
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, top: 60, display: "flex", justifyContent: "space-between", font: `600 22px ${MONO}`, color: "#9fb0c4", opacity: hud }}>
        <span style={{ display: "flex", alignItems: "center", gap: 12, letterSpacing: 3 }}>
          <span style={{ width: 12, height: 12, borderRadius: 12, background: C.passDot, boxShadow: `0 0 0 ${6 + 6 * Math.abs(Math.sin(t * 2.5))}px rgba(126,240,168,${0.25 - 0.2 * Math.abs(Math.sin(t * 2.5))})` }} />
          LIVE
        </span>
        <span style={{ color: "#e6edf5" }}>
          {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Screen position of the chip centre in the Board (chip at 400,240 of 800×500, drawn 1600×1000 from 160,40). */
export const CHIP = { x: 160 + 400 * 2, y: 40 + 240 * 2, w: 280, h: 200 };

// ------------------------------------------------------------------ browser + demo shop

export function Browser({ x, y, w, h, url, children, tag, scale = 1, opacity = 1 }: { x: number; y: number; w: number; h: number; url: string; children: React.ReactNode; tag?: React.ReactNode; scale?: number; opacity?: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 18, overflow: "hidden", background: "#fff", boxShadow: "0 40px 90px rgba(0,0,0,0.45)", transform: `scale(${scale})`, opacity }}>
      <div style={{ height: 64, background: "#eef1f5", borderBottom: "1px solid #dde3ea", display: "flex", alignItems: "center", padding: "0 22px", gap: 10 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 15, height: 15, borderRadius: 15, background: c }} />
        ))}
        <div style={{ marginLeft: 26, flex: 1, height: 40, borderRadius: 10, background: "#fff", border: "1px solid #dde3ea", display: "flex", alignItems: "center", padding: "0 18px", font: `500 20px ${SANS}`, color: C.ink2, gap: 10 }}>
          <svg width="14" height="16" viewBox="0 0 14 16">
            <rect x="1" y="7" width="12" height="8" rx="2" fill="none" stroke={C.muted} strokeWidth="1.6" />
            <path d="M4 7 V5 a3 3 0 0 1 6 0 V7" fill="none" stroke={C.muted} strokeWidth="1.6" />
          </svg>
          {url}
        </div>
        {tag}
      </div>
      <div style={{ position: "relative", height: h - 64 }}>{children}</div>
    </div>
  );
}

/** The demo shop as Kane sees it. Coordinates inside the page area (1500 wide). */
export const SHOP = {
  add: { x: 300, y: 335 },
  email: { x: 460, y: 588 },
  subscribe: { x: 836, y: 588 },
  result: { x: 230, y: 668 },
  count: { x: 470, y: 268 },
};
export function DemoShop({ count = 0, email = "", result, resultP = 1, caret = false, scan = 0, cartOk = 0 }: { count?: number; email?: string; result?: { kind: "err" | "ok"; text: string }; resultP?: number; caret?: boolean; scan?: number; cartOk?: number }) {
  const sec: React.CSSProperties = { position: "absolute", left: 200, width: 1100, border: "1.5px solid #ccc", borderRadius: 12, padding: "22px 30px" };
  const btn: React.CSSProperties = { display: "inline-block", padding: "10px 22px", font: `400 24px ${SITE}`, color: "#111", background: "#efefef", border: "1.5px solid #999", borderRadius: 6 };
  return (
    <div style={{ position: "absolute", inset: 0, background: "#fff", font: `400 26px ${SITE}`, color: "#111" }}>
      <div style={{ position: "absolute", left: 200, top: 54, font: `700 56px ${SITE}` }}>Demo Shop</div>
      <div style={{ ...sec, top: 160, height: 220 }}>
        <div style={{ font: `700 36px ${SITE}`, marginBottom: 18 }}>Cart</div>
        <div style={{ position: "relative", display: "inline-block" }}>
          Items in cart: <b>{count}</b>
          {scan > 0 ? <div style={{ position: "absolute", left: -10, top: -8, width: (220 + 40) * clamp01(scan * 1.6), height: 48, border: `2.5px solid ${C.passDot}`, borderRadius: 8, opacity: scan < 0.85 ? 1 : (1 - scan) / 0.15 }} /> : null}
        </div>
        <div style={{ marginTop: 22 }}>
          <span style={btn}>Add item</span>
        </div>
        {cartOk > 0 ? (
          <div style={{ position: "absolute", right: 30, top: 28, display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 10, background: C.passBg, color: C.pass, font: `600 22px ${SANS}`, opacity: cartOk, transform: `translateY(${8 * (1 - cartOk)}px)` }}>
            <Tick kind="pass" p={cartOk} /> Works
          </div>
        ) : null}
      </div>
      <div style={{ ...sec, top: 420, height: 300 }}>
        <div style={{ font: `700 36px ${SITE}`, marginBottom: 22 }}>Newsletter</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span>Email</span>
          <span style={{ width: 330, height: 48, border: "1.5px solid #888", borderRadius: 4, display: "inline-flex", alignItems: "center", padding: "0 12px", font: `400 24px ${SITE}` }}>
            {email}
            {caret ? <span style={{ width: 2, height: 28, background: "#111", marginLeft: 2 }} /> : null}
          </span>
          <span style={btn}>Subscribe</span>
        </div>
        {result ? (
          <div style={{ marginTop: 34, font: `400 28px ${SITE}`, color: result.kind === "err" ? C.fail : "#116611", opacity: resultP }}>{result.text}</div>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Claude Code terminal

export const ORANGE = "#d97757";
export function Terminal({ x, y, w, h, children, opacity = 1, radius = 18, size = 22 }: { x: number; y: number; w: number; h: number; children: React.ReactNode; opacity?: number; radius?: number; size?: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: radius, overflow: "hidden", background: "#17191d", boxShadow: "0 40px 90px rgba(5,15,35,0.45)", border: "1px solid #2a2e35", opacity }}>
      <div style={{ height: 50, background: "#202329", borderBottom: "1px solid #2a2e35", display: "flex", alignItems: "center", padding: "0 20px", gap: 9 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 13, height: 13, borderRadius: 13, background: c }} />
        ))}
        <span style={{ flex: 1, textAlign: "center", font: `500 18px ${MONO}`, color: "#8b93a1", marginRight: 60 }}>demo-shop — claude</span>
      </div>
      <div style={{ position: "relative", padding: `${size * 1.2}px ${size * 1.5}px`, font: `400 ${size}px/1.55 ${MONO}`, color: "#e6e8eb" }}>{children}</div>
    </div>
  );
}

export function Welcome() {
  return (
    <div style={{ border: `1.5px solid ${ORANGE}`, borderRadius: 10, padding: "16px 22px", width: "fit-content", minWidth: 620 }}>
      <div>
        <span style={{ color: ORANGE }}>✻</span> Welcome to <b>Claude Code</b>!
      </div>
      <div style={{ color: "#8b93a1", marginTop: 14, fontSize: "0.86em" }}>/help for help, /status for your current setup</div>
      <div style={{ color: "#8b93a1", marginTop: 6, fontSize: "0.86em" }}>cwd: ~/demo-shop</div>
    </div>
  );
}

export function Prompt({ text, caret = true, dim }: { text?: React.ReactNode; caret?: boolean; dim?: string }) {
  return (
    <div style={{ marginTop: 22, border: "1.5px solid #4a505a", borderRadius: 10, padding: "12px 18px", display: "flex", gap: 14 }}>
      <span style={{ color: "#8b93a1" }}>&gt;</span>
      <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>
        {text ? text : dim ? <span style={{ color: "#6b7380" }}>{dim}</span> : null}
        {caret ? <span style={{ display: "inline-block", width: 12, height: 26, background: "#e6e8eb", verticalAlign: "-5px", marginLeft: 2 }} /> : null}
      </span>
    </div>
  );
}

/** A Claude Code message: ⏺ bullet, text, optional result lines under ⎿. */
export function Msg({ p = 1, done = true, children, sub }: { p?: number; done?: boolean; children: React.ReactNode; sub?: React.ReactNode }) {
  if (p <= 0) return null;
  return (
    <div style={{ marginTop: 18, opacity: E(clamp01(p * 2)), transform: `translateY(${10 * (1 - E(clamp01(p * 2)))}px)` }}>
      <div style={{ display: "flex", gap: 14 }}>
        <span style={{ color: done ? C.passDot : "#e6e8eb" }}>⏺</span>
        <span>{children}</span>
      </div>
      {sub ? <div style={{ display: "flex", gap: 14, marginLeft: 8, marginTop: 4, color: "#a9b1bd" }}>
        <span style={{ color: "#6b7380" }}>⎿</span>
        <div>{sub}</div>
      </div> : null}
    </div>
  );
}

// ------------------------------------------------------------------ result page

export const MESSAGE = [
  "Use Greenlight to fix my app until Kane CLI passes every claim.",
  "First run: curl -fsSL greenlight-api-xi.vercel.app/app/downloads/…/greenlight.md",
  "Then follow those instructions exactly, with:",
  "- GREENLIGHT_CHECK: prj_7c1e…",
  "- GREENLIGHT_TOKEN: ●●●●●●●●●●●●●●●●●●●●●●●●",
];

export type ResultState = {
  cart: number; // 0..1 passed shown
  news: number; // 0..1 failed shown
  newsPass: number; // 0..1 flip to passed
  head: number; // 0..1 headline shown
  headPass: number; // 0..1 headline passed
  note: number; // 0..1 note highlight
  fix: number; // 0..1 suggested-fix highlight
  card: number; // 0..1 Fix card glow
  connect: number; // 0..1 message shown
  copied: number; // 0..1 message copied
  install: number; // 0..1 install section open
  installCopied: number;
  pill: number; // 0..1 status pill visible
  dotOnly?: number; // 0..1 everything but the status dot fades
  noDot?: boolean;
  noteVis?: number;
};
export const RS0: ResultState = { cart: 0, news: 0, newsPass: 0, head: 0, headPass: 0, note: 0, fix: 0, card: 0, connect: 0, copied: 0, install: 0, installCopied: 0, pill: 0 };

/** Key positions in the result page (world coordinates), for the camera and pointer. */
export const RP = {
  quote: { x: 262.5, y: 958.5 }, // left edge, vertical centre of Kane's quoted words
  card: { x: 1190, y: 350, w: 520 },
  connect: { x: 1450, y: 606 },
  copy: { x: 1640, y: 586 },
  install: { x: 1300, y: 676 },
  dot: { x: 1556, y: 202 },
};
export const QUOTE = "Subscription failed. Please try again later.";
export const QUOTE_FONT = `400 24px ${SITE}`;

export function ResultWorld({ s, drift = 0 }: { s: ResultState; drift?: number; intro?: number }) {
  const fade = 1 - (s.dotOnly ?? 0);
  const passed = s.headPass > 0.5;
  const connectH = 250 * E(s.connect);
  const installH = 300 * E(s.install);
  const cardH = 360 + connectH + installH;
  const newsKind: "pass" | "fail" | null = s.newsPass > 0 ? "pass" : s.news > 0 ? "fail" : null;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ opacity: fade }}>
        <Nav active="My checks" />
        <div style={{ position: "absolute", left: 210, top: 118, font: `500 26px ${SANS}`, color: "rgba(255,255,255,0.88)" }}>Check</div>
        <div style={{ position: "absolute", left: 206, top: 148, font: `700 84px/1 ${SANS}`, color: "#fff", letterSpacing: -2 }}>Demo Shop</div>
        <div style={{ position: "absolute", left: 210, top: 262, width: 900, height: 60, borderRadius: 14, background: "rgba(255,255,255,0.94)", display: "flex", alignItems: "center", padding: "0 22px", gap: 10, font: `500 22px ${SANS}`, color: C.ink }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} style={{ width: 13, height: 13, borderRadius: 13, background: c }} />
          ))}
          <span style={{ marginLeft: 16 }}>greenlight-demo-shop.vercel.app</span>
          <span style={{ marginLeft: "auto", color: C.blueInk }}>Open ↗</span>
        </div>
        <div style={{ position: "absolute", left: 1132, top: 262, height: 60, borderRadius: 14, border: "1.5px solid rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", padding: "0 22px", font: `500 21px ${SANS}`, color: "#fff" }}>xdgram/greenlight</div>

        {/* Verdict */}
        <Panel x={210} y={350} w={940} h={272} top="Verdict from Kane CLI" right={s.head > 0 ? (passed ? "2 of 2 passed" : "1 of 2 passed") : "2 claims"}>
          <div style={{ position: "absolute", left: 30, top: 22, font: `400 20px ${SANS}`, color: C.muted }}>Tested on greenlight-demo-shop.vercel.app</div>
          <div style={{ position: "absolute", left: 26, top: 56, height: 100, width: 600 }}>
            <div style={{ position: "absolute", font: `700 94px/1 ${SANS}`, color: C.fail, letterSpacing: -2, opacity: s.head * (1 - s.headPass), transform: `translateY(${12 * (1 - E(s.head))}px)` }}>Failed</div>
            <div style={{ position: "absolute", font: `700 94px/1 ${SANS}`, color: C.pass, letterSpacing: -2, opacity: s.headPass, transform: `translateY(${12 * (1 - E(s.headPass))}px)` }}>Passed</div>
          </div>
          <div style={{ position: "absolute", left: 30, top: 168, font: `400 21px ${SANS}`, color: C.ink2, opacity: s.head }}>
            {passed ? "Kane confirmed every claim on your live app." : "Kane found a claim that is not true on your live app."}
          </div>
        </Panel>

        {/* Claims */}
        <Panel x={210} y={642} w={940} h={420} top="Claims" right="2 tested">
          <Row y={18} n="01" text="Users can add items to the cart and the cart count goes up" kind={s.cart > 0 ? "pass" : null} p={s.cart} />
          <Row y={94} n="02" text="Users can subscribe to the newsletter and see a confirmation" kind={newsKind} p={s.newsPass > 0 ? s.newsPass : s.news} />
          <div style={{ position: "absolute", left: 22, right: 22, top: 172, height: 166, borderRadius: 16, border: `1.5px solid ${s.newsPass > 0 ? C.line : "#f3c8bd"}`, background: "#fff", opacity: Math.max(s.noteVis ?? 0, s.news > 0 ? 1 : 0) * (1 - s.newsPass * 0.6), boxShadow: `0 0 0 ${5 * s.note}px rgba(239,90,60,${0.18 * s.note})` }}>
            <div style={{ position: "absolute", left: 22, top: 14, font: `700 18px/1 ${SANS}`, color: C.ink }}>What Kane saw</div>
            <div style={{ position: "absolute", left: 22, top: 42, font: `400 20px/1 ${SANS}`, color: C.ink2 }}>Three valid email submissions all returned</div>
            <div style={{ position: "absolute", left: 22, top: 72, font: QUOTE_FONT, lineHeight: 1, color: C.fail, whiteSpace: "nowrap" }}>{QUOTE}</div>
            <div style={{ position: "absolute", left: 16, top: 106, font: `700 18px/1 ${SANS}`, color: C.ink, padding: "4px 6px", borderRadius: 6, background: `rgba(59,130,230,${0.14 * s.fix})` }}>Suggested fix</div>
            <div style={{ position: "absolute", left: 16, right: 16, top: 132, font: `400 19px/1.3 ${SANS}`, color: C.ink2, padding: "2px 6px", borderRadius: 6, background: `rgba(59,130,230,${0.1 * s.fix})`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>The form misreads the server's reply. Fix it, deploy, then check again, or let Claude Code do it.</div>
          </div>
        </Panel>

        {/* Status pill (dot drawn separately below) */}
        <div style={{ position: "absolute", left: 1530, top: 176, height: 52, padding: "0 24px 0 48px", borderRadius: 14, border: "1.5px solid rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", font: `600 22px ${SANS}`, color: "#fff", opacity: s.pill }}>{passed ? "Passed" : "Failed"}</div>

        {/* Fix it with Claude Code */}
        <div style={{ position: "absolute", left: RP.card.x, top: RP.card.y, width: RP.card.w, height: cardH + 14, borderRadius: 30, background: "rgba(255,255,255,0.2)", border: "1.5px solid rgba(255,255,255,0.5)", boxShadow: `0 20px 50px rgba(20,50,100,0.16), 0 0 0 ${5 * s.card}px rgba(255,255,255,${0.6 * s.card})` }}>
          <div style={{ position: "absolute", inset: 7, borderRadius: 24, background: "#fff", padding: "26px 28px", boxShadow: `inset 0 0 0 ${2.5 * s.card}px rgba(59,130,230,${0.55 * s.card})` }}>
            <div style={{ font: `400 18px ${SANS}`, color: C.muted }}>Close the loop</div>
            <div style={{ font: `700 33px ${SANS}`, color: C.ink, marginTop: 6, letterSpacing: -0.5 }}>Fix it with Claude Code</div>
            <div style={{ font: `400 19.5px/1.5 ${SANS}`, color: C.ink2, marginTop: 10 }}>Paste one message into Claude Code. It reads Kane's verdict, fixes what failed, pushes, and asks Kane to check again until every claim passes.</div>
            <div style={{ position: "relative", height: 72 + connectH, marginTop: 18 }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 62, borderRadius: 40, background: C.ink, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, font: `600 21px ${SANS}`, opacity: 1 - s.connect }}>
                Connect Claude Code <span style={{ color: "#9aa5b3", fontWeight: 500 }}>1 paste</span>
              </div>
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, opacity: s.connect }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", font: `500 18px ${SANS}`, color: C.muted }}>
                  Paste this into Claude Code
                  <CopyBtn copied={s.copied} />
                </div>
                <div style={{ marginTop: 10, borderRadius: 14, background: C.ink, padding: "14px 16px", font: `400 14.5px/1.55 ${MONO}`, color: "#e6edf5", height: 186, overflow: "hidden" }}>
                  {MESSAGE.map((l, i) => (
                    <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", filter: i === 4 ? "blur(0px)" : undefined }}>{l}</div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16, font: `500 20px ${SANS}`, color: C.blueInk, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "inline-block", transform: `rotate(${90 * s.install}deg)`, fontSize: 14 }}>▶</span> First time? Install Claude Code
            </div>
            <div style={{ height: installH, overflow: "hidden", opacity: s.install }}>
              <div style={{ font: `400 18px/1.5 ${SANS}`, color: C.ink2, marginTop: 14 }}>You need Git and Claude Code. About five minutes, once.</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, font: `600 18px ${SANS}`, color: C.ink }}>
                macOS or Linux
                <CopyBtn copied={s.installCopied} />
              </div>
              <div style={{ marginTop: 10, borderRadius: 14, background: C.ink, padding: "16px 18px", font: `400 16px/1.6 ${MONO}`, color: "#e6edf5" }}>
                curl -fsSL https://claude.ai/install.sh | bash
                <br />
                claude
              </div>
              <div style={{ font: `400 17px/1.5 ${SANS}`, color: C.muted, marginTop: 12 }}>Windows: one PowerShell line, on the same page.</div>
            </div>
          </div>
        </div>
      </div>
      {/* The status dot stays when everything else fades. */}
      <div style={{ position: "absolute", left: RP.dot.x - 7, top: RP.dot.y - 7, width: 14, height: 14, borderRadius: 14, background: passed ? C.passDot : C.failDot, opacity: s.noDot ? 0 : Math.max(s.pill, s.dotOnly ?? 0) }} />
    </div>
  );
}

function CopyBtn({ copied }: { copied: number }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 10, border: `1.5px solid ${C.lineStrong}`, font: `500 17px ${SANS}`, color: copied > 0.5 ? C.pass : C.ink }}>
      {copied > 0.5 ? "✓ Copied" : "Copy"}
    </span>
  );
}

function Row({ y, n, text, kind, p }: { y: number; n: string; text: string; kind: "pass" | "fail" | null; p: number }) {
  return (
    <div style={{ position: "absolute", left: 22, right: 22, top: y, height: 64, borderRadius: 16, border: `1.5px solid ${kind === "fail" ? "#f3c8bd" : C.line}`, background: kind === "fail" ? "#fffaf8" : "#f8fafc", display: "flex", alignItems: "center", padding: "0 18px", gap: 16 }}>
      <Tick kind={kind} p={p} />
      <span style={{ font: `400 17px ${MONO}`, color: C.faint }}>{n}</span>
      <span style={{ font: `500 21px ${SANS}`, color: C.ink, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
      {kind ? <Badge kind={kind} p={p} /> : null}
    </div>
  );
}

export { ramp };
