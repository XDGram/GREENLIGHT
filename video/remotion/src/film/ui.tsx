import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, mix, MONO, OUT, ramp, SANS } from "./kit";

// The interface as it appears in the film: a polished take on Greenlight, designed for the
// screen at 1080p (bigger type, fewer lines, deeper shadows), not a screenshot of the test site.

export const C = {
  ink: "#0b0f17",
  ink2: "#2a3140",
  muted: "#6b7586",
  line: "#e6eaf1",
  soft: "#f4f6fa",
  green: "#2ee68a",
  greenInk: "#0f8a4c",
  greenSoft: "#e6fbef",
  red: "#ff5a45",
  redInk: "#c2321f",
  redSoft: "#fff0ed",
  blue: "#3b82f6",
  night: "#05070d",
};

// ------------------------------------------------------------------ worlds

/** Deep night with two slow blooms of colour. For type-led moments. */
export function Night({ t, tint = "#1b3a7a", accent = "#0f5a3a" }: { t: number; tint?: string; accent?: string }) {
  const a = 30 + Math.sin(t * 0.25) * 6;
  const b = 70 + Math.cos(t * 0.21) * 6;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(900px 700px at ${a}% 30%, ${tint}88, transparent 70%), radial-gradient(800px 600px at ${b}% 78%, ${accent}77, transparent 70%), ${C.night}`,
      }}
    >
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55))" }} />
    </AbsoluteFill>
  );
}

/** The bright sky the product lives in, with a few drifting clouds. */
export function Sky({ t, clouds = true, dim = 0 }: { t: number; clouds?: boolean; dim?: number }) {
  return (
    <AbsoluteFill style={{ background: "linear-gradient(180deg, #2f7be0 0%, #4f95ea 45%, #8fbdf2 100%)" }}>
      {clouds ? (
        <>
          <Img src={staticFile("img/cloud-one2.png")} style={{ position: "absolute", width: 520, left: -120 + t * 8, top: 90, opacity: 0.95 }} />
          <Img src={staticFile("img/cloud-one4.png")} style={{ position: "absolute", width: 420, right: -80 - t * 6, top: 620, opacity: 0.9 }} />
          <Img src={staticFile("img/cloud-one9.png")} style={{ position: "absolute", width: 300, left: 1500 - (t % 60) * 3, top: 40, opacity: 0.8 }} />
        </>
      ) : null}
      {dim ? <AbsoluteFill style={{ background: C.night, opacity: dim }} /> : null}
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ brand

export function Wordmark({ h = 90, ink = false, style }: { h?: number; ink?: boolean; style?: React.CSSProperties }) {
  return <Img src={staticFile(ink ? "img/wordmark-ink.svg" : "img/wordmark-white.svg")} style={{ height: h, display: "block", ...style }} />;
}

// ------------------------------------------------------------------ window chrome

export function Window({ x, y, w, h, url, children, dark = false, style }: { x: number; y: number; w: number; h: number; url?: string; children: React.ReactNode; dark?: boolean; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 22,
        overflow: "hidden",
        background: dark ? "#0d1016" : "#fff",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 50px 120px rgba(4,14,40,0.45), 0 12px 30px rgba(4,14,40,0.25)",
        ...style,
      }}
    >
      <div style={{ height: 56, display: "flex", alignItems: "center", gap: 18, padding: "0 22px", background: dark ? "#14181f" : "#f6f8fb", borderBottom: `1px solid ${dark ? "#222833" : C.line}` }}>
        <div style={{ display: "flex", gap: 9 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} style={{ width: 14, height: 14, borderRadius: 14, background: c }} />
          ))}
        </div>
        {url ? (
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div style={{ minWidth: 420, padding: "8px 18px", borderRadius: 10, background: dark ? "#1c212b" : "#fff", border: `1px solid ${dark ? "#2a303c" : C.line}`, font: `500 17px ${SANS}`, color: dark ? "#aab3c2" : C.muted, textAlign: "center" }}>🔒 {url}</div>
          </div>
        ) : null}
      </div>
      <div style={{ position: "absolute", inset: "56px 0 0 0" }}>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ app pieces

export function AppBar({ active = "New check" }: { active?: string }) {
  return (
    <div style={{ height: 76, display: "flex", alignItems: "center", gap: 30, padding: "0 40px", borderBottom: `1px solid ${C.line}` }}>
      <Wordmark h={34} ink />
      <div style={{ display: "flex", gap: 6, marginLeft: 20 }}>
        {["New check", "My checks"].map((n) => (
          <span key={n} style={{ padding: "9px 16px", borderRadius: 10, font: `600 18px ${SANS}`, color: n === active ? C.ink : C.muted, background: n === active ? C.soft : "transparent" }}>{n}</span>
        ))}
      </div>
      <div style={{ marginLeft: "auto", width: 38, height: 38, borderRadius: 38, background: "linear-gradient(135deg,#7aa7ff,#2ee68a)" }} />
    </div>
  );
}

export function Field({ label, value, focus = 0, placeholder, mono = false, h = 70, icon }: { label: string; value: string; focus?: number; placeholder?: string; mono?: boolean; h?: number; icon?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ font: `600 18px ${SANS}`, color: C.ink2 }}>{label}</span>
      <div
        style={{
          minHeight: h,
          padding: "0 22px",
          display: "flex",
          alignItems: mono ? "flex-start" : "center",
          gap: 12,
          borderRadius: 16,
          background: "#fff",
          border: `1.5px solid ${focus > 0.5 ? C.blue : C.line}`,
          boxShadow: `0 0 0 ${focus * 5}px rgba(59,130,246,0.18)`,
          font: mono ? `400 20px/1.7 ${MONO}` : `500 22px ${SANS}`,
          color: value ? C.ink : "#aab2c0",
          whiteSpace: "pre-wrap",
          paddingTop: mono ? 16 : 0,
        }}
      >
        {icon ? <span style={{ fontSize: 22 }}>{icon}</span> : null}
        <span>
          {value || placeholder}
          {focus > 0.5 ? <span style={{ display: "inline-block", width: 2, height: "1em", background: C.blue, marginLeft: 2, verticalAlign: "-0.15em" }} /> : null}
        </span>
      </div>
    </div>
  );
}

export function Button({ text, kind = "dark", down = 0, glow = 0, style, sub }: { text: string; kind?: "dark" | "green" | "light"; down?: number; glow?: number; style?: React.CSSProperties; sub?: string }) {
  const bg = kind === "dark" ? C.ink : kind === "green" ? C.green : "#fff";
  const fg = kind === "green" ? "#04130b" : kind === "dark" ? "#fff" : C.ink;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "20px 34px",
        borderRadius: 16,
        background: bg,
        color: fg,
        font: `700 23px ${SANS}`,
        transform: `scale(${1 - 0.06 * down})`,
        boxShadow: `0 ${10 - 6 * down}px 26px rgba(10,20,40,0.22), 0 0 ${glow * 60}px ${glow * 6}px rgba(46,230,138,${0.55 * glow})`,
        border: kind === "light" ? `1.5px solid ${C.line}` : "none",
        ...style,
      }}
    >
      {text}
      {sub ? <span style={{ opacity: 0.6, fontWeight: 600 }}>{sub}</span> : null}
    </div>
  );
}

export function Switch({ on }: { on: number }) {
  return (
    <div style={{ width: 64, height: 36, borderRadius: 36, background: on > 0.5 ? C.green : "#d5dbe5", position: "relative", flex: "none" }}>
      <div style={{ position: "absolute", top: 4, left: mix(4, 32, on), width: 28, height: 28, borderRadius: 28, background: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.2)" }} />
    </div>
  );
}

export function ClaimRow({ n, text, sub, on = 1, p = 1, status }: { n: string; text: string; sub?: string; on?: number; p?: number; status?: "pass" | "fail" | "run" }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 22,
        padding: "24px 28px",
        borderRadius: 20,
        background: "#fff",
        border: `1.5px solid ${status === "fail" ? "#ffc8bf" : status === "pass" ? "#b5f0cf" : C.line}`,
        boxShadow: "0 10px 30px rgba(10,30,70,0.08)",
        transform: `translateY(${(1 - p) * 60}px) scale(${mix(0.94, 1, p)})`,
        opacity: clamp01(p * 1.4),
      }}
    >
      {status ? <StatusDot status={status} /> : <Switch on={on} />}
      <span style={{ font: `500 17px ${MONO}`, color: "#a4adbb" }}>{n}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        <span style={{ font: `700 25px ${SANS}`, color: C.ink, letterSpacing: "-0.015em" }}>{text}</span>
        {sub ? <span style={{ font: `500 18px ${SANS}`, color: C.muted }}>{sub}</span> : null}
      </div>
      {status ? <Badge status={status} /> : null}
    </div>
  );
}

export function StatusDot({ status }: { status: "pass" | "fail" | "run" }) {
  const c = status === "pass" ? C.green : status === "fail" ? C.red : "#f5b83d";
  return (
    <div style={{ width: 36, height: 36, borderRadius: 11, background: c, display: "grid", placeItems: "center", color: "#fff", font: `800 22px ${SANS}`, boxShadow: `0 6px 18px ${c}66`, flex: "none" }}>
      {status === "pass" ? "✓" : status === "fail" ? "✕" : "…"}
    </div>
  );
}

export function Badge({ status }: { status: "pass" | "fail" | "run" }) {
  const [bg, fg, text] = status === "pass" ? [C.greenSoft, C.greenInk, "Passed"] : status === "fail" ? [C.redSoft, C.redInk, "Failed"] : ["#fff6e0", "#9a6a00", "Testing"];
  return <span style={{ padding: "10px 18px", borderRadius: 999, background: bg, color: fg, font: `800 19px ${SANS}` }}>{text}</span>;
}

// ------------------------------------------------------------------ the demo shop (the app under test)

export function Shop({ count, email, msg, adding = 0 }: { count: number; email: string; msg?: "fail" | "ok"; adding?: number }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#fbfaf7", padding: "46px 70px", fontFamily: SANS }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "#111", color: "#fff", display: "grid", placeItems: "center", font: `800 22px ${SANS}` }}>D</div>
        <span style={{ font: `800 34px ${SANS}`, letterSpacing: "-0.03em" }}>Demo Shop</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderRadius: 999, background: "#fff", border: "1px solid #ebe7de", font: `700 20px ${SANS}` }}>
          🛒 <span style={{ display: "inline-block", transform: `scale(${1 + 0.5 * adding})`, color: count ? C.greenInk : C.ink }}>{count}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 28, marginTop: 40 }}>
        <div style={{ flex: 1, borderRadius: 22, background: "#fff", border: "1px solid #ebe7de", padding: 28 }}>
          <div style={{ height: 170, borderRadius: 16, background: "linear-gradient(135deg,#f6e7cf,#e9d4b3)", display: "grid", placeItems: "center", fontSize: 86 }}>☕</div>
          <div style={{ marginTop: 18, font: `700 26px ${SANS}` }}>Stoneware mug</div>
          <div style={{ marginTop: 4, font: `500 20px ${SANS}`, color: C.muted }}>$24.00</div>
          <div style={{ marginTop: 18, display: "inline-block", padding: "14px 26px", borderRadius: 12, background: "#111", color: "#fff", font: `700 20px ${SANS}` }}>Add item</div>
        </div>
        <div style={{ flex: 1.2, borderRadius: 22, background: "#fff", border: "1px solid #ebe7de", padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ font: `800 28px ${SANS}` }}>Newsletter</div>
          <div style={{ font: `500 19px ${SANS}`, color: C.muted }}>New arrivals, once a month.</div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1, padding: "16px 18px", borderRadius: 12, border: "1.5px solid #e2ddd3", font: `500 20px ${SANS}`, color: email ? C.ink : "#b3ada2" }}>{email || "you@example.com"}</div>
            <div style={{ padding: "16px 24px", borderRadius: 12, background: "#111", color: "#fff", font: `700 20px ${SANS}` }}>Subscribe</div>
          </div>
          {msg === "fail" ? <div style={{ padding: "14px 18px", borderRadius: 12, background: C.redSoft, color: C.redInk, font: `700 20px ${SANS}` }}>Subscription failed. Please try again later.</div> : null}
          {msg === "ok" ? <div style={{ padding: "14px 18px", borderRadius: 12, background: C.greenSoft, color: C.greenInk, font: `700 20px ${SANS}` }}>Thanks for subscribing, ada@example.com!</div> : null}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Claude Code terminal

export const ORANGE = "#d97757";

export function Terminal({ x, y, w, h, children, title = "demo-shop — claude", style }: { x: number; y: number; w: number; h: number; children: React.ReactNode; title?: string; style?: React.CSSProperties }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 22, overflow: "hidden", background: "#111318", boxShadow: "0 0 0 1px rgba(255,255,255,0.07), 0 50px 120px rgba(0,0,0,0.6)", ...style }}>
      <div style={{ height: 52, display: "flex", alignItems: "center", padding: "0 20px", gap: 9, background: "#181b21", borderBottom: "1px solid #23272f" }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 13, height: 13, borderRadius: 13, background: c }} />
        ))}
        <span style={{ flex: 1, textAlign: "center", font: `500 16px ${MONO}`, color: "#7d8594", marginRight: 60 }}>{title}</span>
      </div>
      <div style={{ padding: "28px 34px", font: `400 25px/1.55 ${MONO}`, color: "#e6e8eb" }}>{children}</div>
    </div>
  );
}

/** One Claude Code step: a dot that turns green when done, then the text, rising in. */
export function Step({ p, done = true, children, sub }: { p: number; done?: boolean; children: React.ReactNode; sub?: React.ReactNode }) {
  if (p <= 0) return null;
  return (
    <div style={{ marginTop: 18, opacity: clamp01(p * 1.5), transform: `translateY(${(1 - OUT(clamp01(p))) * 18}px)`, filter: `blur(${(1 - clamp01(p)) * 6}px)` }}>
      <div style={{ display: "flex", gap: 16 }}>
        <span style={{ color: done ? "#3ad583" : ORANGE }}>●</span>
        <span>{children}</span>
      </div>
      {sub ? <div style={{ marginLeft: 34, marginTop: 6, color: "#9aa2b0" }}>{sub}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------ Kane core (the chip)

export function KaneCore({ t, power = 1 }: { t: number; power?: number }) {
  return (
    <div style={{ position: "relative", width: 360, height: 360 }}>
      {[0, 1, 2].map((i) => {
        const r = 150 + i * 70 + ((t * 40) % 70);
        return <div key={i} style={{ position: "absolute", left: 180 - r, top: 180 - r, width: r * 2, height: r * 2, borderRadius: "50%", border: `2px solid rgba(46,230,138,${0.35 * power * (1 - ((t * 40) % 70) / 70)})` }} />;
      })}
      <div style={{ position: "absolute", left: 60, top: 60, width: 240, height: 240, borderRadius: 54, background: "linear-gradient(160deg,#1b2230,#0b0f16)", boxShadow: `0 0 0 1.5px rgba(255,255,255,0.08), 0 0 ${80 * power}px rgba(46,230,138,${0.35 * power}), 0 30px 60px rgba(0,0,0,0.6)`, display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ font: `800 50px ${SANS}`, color: "#fff", letterSpacing: "-0.04em" }}>Kane</div>
          <div style={{ font: `600 20px ${MONO}`, color: C.green, letterSpacing: "0.2em", marginTop: 6 }}>CLI</div>
        </div>
      </div>
    </div>
  );
}

export const appear = (t: number, a: number, len = 0.6) => ramp(t, a, a + len);
