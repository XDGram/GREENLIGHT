import React from "react";
import { AbsoluteFill } from "remotion";
import { camera, clamp01, Cursor, E, EIO, keys, mix, path, press, ramp, Ripple, Sfx, typed, Typing, useT } from "./lib";
import { say, voEnd } from "./timeline";
import { Board, Browser, C, CHIP, DemoShop, Mark, measure, MONO, Msg, ORANGE, Prompt, QUOTE, QUOTE_FONT, RP, RS0, ResultWorld, ResultState, SANS, SHOP, SITE, Sky, Terminal, Welcome, Wordmark, Nav, Panel, Tick } from "./ui";

const ERR = "Subscription failed. Please try again later.";
const OK = "Thanks for subscribing, ada@example.com!";

// ================================================================== 1. The promise

const R_LINES = ["# Demo Shop", "- Users can add items to the cart", "- Users can subscribe to the newsletter"];
export function Promise() {
  const t = useT();
  const F = `400 60px ${MONO}`;
  const ys = [372, 494, 584];
  let start = 0.35;
  const shown = R_LINES.map((l, i) => {
    const s = start;
    start += l.length / 24 + (i === 0 ? 0.35 : 0.2);
    return { text: typed(l, t, s, 24), s };
  });
  const lastDone = shown[2].s + R_LINES[2].length / 24;
  const dotX = 250 + measure(R_LINES[2], F) + 13;
  const dotY = ys[2] + 60 * 0.74;
  const q = say("promise", "But does the live app");
  const push = ramp(t, q, q + 3, EIO);
  const end = ramp(t, 8.7, 10.3, EIO);
  const cx = mix(mix(960, 820, push), dotX, end);
  const cy = mix(mix(540, 470, push), dotY, end);
  const k = mix(mix(1, 1.12, push), 1.6, end);
  const fade = 1 - ramp(t, 8.6, 9.6);
  const green = ramp(t, say("promise", "keep them"), say("promise", "keep them") + 0.5);
  const sx = 960 + (dotX - cx) * k;
  const sy = 540 + (dotY - cy) * k;
  const r = mix(5.2 * k, 18, end);
  const dot = t > lastDone + 0.05 ? 1 : 0;
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      <div style={camera(cx, cy, k)}>
        {shown.map((l, i) => (
          <div key={i} style={{ position: "absolute", left: 250, top: ys[i], font: F, lineHeight: 1, whiteSpace: "pre", color: i === 0 ? C.ink : C.ink2, opacity: i === 2 ? 1 - ramp(t, 9.0, 9.9) : fade }}>
            {l.text}
            {t > l.s && t < l.s + R_LINES[i].length / 24 + 0.4 ? <span style={{ display: "inline-block", width: 4, height: 52, background: C.ink, verticalAlign: "-9px", marginLeft: 3, height: 58 }} /> : null}
          </div>
        ))}
      </div>
      {dot ? <div style={{ position: "absolute", left: sx - r, top: sy - r, width: r * 2, height: r * 2, borderRadius: "50%", background: green > 0 ? `rgb(${mix(20, 34, green)},${mix(26, 179, green)},${mix(34, 107, green)})` : C.ink, boxShadow: `0 0 ${40 * green * end}px rgba(126,240,168,${0.6 * green})` }} /> : null}
      {R_LINES.map((l, i) => (
        <Typing key={i} start={shown[i].s} text={l} cps={24} volume={0.12} />
      ))}
    </AbsoluteFill>
  );
}

// ================================================================== 2. Greenlight

/** Where the mark sits when its light is at (x, y) with size m. */
const markAt = (x: number, y: number, m: number) => ({ left: x - (19.1 / 24) * m, top: y - (6.4 / 24) * m });

export function Brand() {
  const t = useT();
  const grow = ramp(t, 0.35, 1.5);
  const draw = ramp(t, 0.9, 2.1, EIO);
  const wipe = ramp(t, 0.9, 2.5, EIO);
  const lock = ramp(t, 2.3, 3.6, EIO);
  const out = ramp(t, 11.3, 12.5, EIO);
  // Lockup geometry (centred), then the nav position.
  const M0 = 216,
    M1 = 172,
    M2 = 44;
  const WH1 = 118,
    WH2 = 30;
  const ww1 = (WH1 * 4925) / 1100;
  const lockLeft = 960 - (M1 + 30 + ww1) / 2;
  const lockTop = 395;
  const m = mix(mix(M0, M1, lock), M2, out);
  const start = markAt(960, 540, M0);
  const mx = mix(mix(start.left, lockLeft, lock), 210, out);
  const my = mix(mix(start.top, lockTop, lock), 24, out);
  const wh = mix(WH1, WH2, out);
  const wx = mx + m + mix(30, 14, out);
  const wy = my + (m - wh) / 2;
  const sub = 1 - ramp(t, 11.0, 11.8);
  const tag = ramp(t, 3.4, 4.4) * sub;
  const kane = ramp(t, say("brand", "using Kane CLI"), say("brand", "using Kane CLI") + 0.6) * sub;
  const claude = ramp(t, say("brand", "and Claude Code"), say("brand", "and Claude Code") + 0.6) * sub;
  const r = 2300 * wipe;
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      <div style={{ position: "absolute", inset: 0, clipPath: `circle(${r}px at 960px 540px)` }}>
        <Sky drift={t} />
      </div>
      <div style={{ position: "absolute", left: mx, top: my }}>
        <Mark size={m} tile={grow} draw={draw} />
      </div>
      <div style={{ position: "absolute", left: wx, top: wy }}>
        <Wordmark height={wh} reveal={ramp(t, 2.7, 3.8, EIO)} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 640, textAlign: "center", font: `500 40px ${SANS}`, color: "#fff", opacity: tag, transform: `translateY(${14 * (1 - tag)}px)` }}>Does your app do what its README says?</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 740, display: "flex", justifyContent: "center", gap: 22 }}>
        <Chip p={kane} label="Kane CLI tests it" />
        <Chip p={claude} label="Claude Code fixes it" />
      </div>
    </AbsoluteFill>
  );
}

function Chip({ p, label }: { p: number; label: string }) {
  return (
    <div style={{ opacity: p, transform: `translateY(${12 * (1 - p)}px)`, padding: "14px 26px", borderRadius: 16, border: "1.5px solid rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.18)", color: "#fff", font: `600 26px ${SANS}`, display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 10, height: 10, borderRadius: 10, background: C.lamp }} />
      {label}
    </div>
  );
}

// ================================================================== 3. Start a check

const REPO = "https://github.com/XDGram/GREENLIGHT";
const URL = "https://greenlight-demo-shop.vercel.app";
const README = ["# Demo Shop", "", "## Features", "", "- Users can add items to the cart and the cart count goes up", "- Users can subscribe to the newsletter and see a confirmation"];
const TA = { x: 257, y: 596, w: 1430, h: 250 };
const TA_LINE = (i: number) => TA.y + 18 + i * 34;
export const CLAIM_ROWS = [
  { x: 391, y: 333, w: 1138, h: 128 },
  { x: 391, y: 483, w: 1138, h: 128 },
];

export function Start() {
  const t = useT();
  const tRepo = say("start", "your code on GitHub");
  const tUrl = say("start", "the link to your live app");
  const tReadme = say("start", "and your README");
  const tClick = say("start", "No account, no setup", true) + 0.25;
  const drop = tReadme + 0.75;
  const filled = ramp(t, drop, drop + 0.4);
  const lift = ramp(t, 10.3, 11.8, EIO);
  const page = 1 - ramp(t, 10.2, 11.0);
  const k = 1;
  // File icon path.
  const fp = path(t, [
    [tReadme - 0.6, 2040, 760],
    [tReadme + 0.1, 1500, 640],
    [drop, 980, 712],
  ]);
  const fileVis = t > tReadme - 0.6 && t < drop + 0.15 ? 1 - ramp(t, drop, drop + 0.15) : 0;
  const cur = path(t, [
    [6.3, 1500, 1120],
    [tClick - 0.25, 370, 943],
    [tClick + 1, 372, 946],
  ]);
  const down = press(t, tClick);
  const spin = t > tClick + 0.1;
  return (
    <AbsoluteFill>
      <Sky drift={t + 13} />
      <Nav />
      <div style={{ ...camera(960 + 0, 540 + 0, k), opacity: 1 }}>
        <div style={{ opacity: page }}>
          <div style={{ position: "absolute", left: 210, top: 118, font: `500 26px ${SANS}`, color: "rgba(255,255,255,0.88)" }}>New check</div>
          <div style={{ position: "absolute", left: 206, top: 148, font: `700 84px/1 ${SANS}`, color: "#fff", letterSpacing: -2 }}>Check an app</div>
          <div style={{ position: "absolute", left: 210, top: 290, width: 1500, height: 740, borderRadius: 30, background: "rgba(255,255,255,0.2)", border: "1.5px solid rgba(255,255,255,0.5)" }}>
            <div style={{ position: "absolute", inset: 7, borderRadius: 24, background: "#fff" }} />
          </div>
          <div style={{ position: "absolute", left: 257, top: 334, font: `700 34px ${SANS}`, color: C.ink }}>Your app</div>
          <div style={{ position: "absolute", left: 1600, top: 338, padding: "6px 14px", borderRadius: 12, background: C.panel2, font: `500 18px ${SANS}`, color: C.muted }}>Step 1</div>
          <Field x={257} y={406} w={700} label="GitHub repository" value={typed(REPO, t, tRepo, 30)} ph="https://github.com/you/your-app" caret={t > tRepo && t < tUrl} />
          <Field x={987} y={406} w={700} label="Live app URL" value={typed(URL, t, tUrl, 30)} ph="https://your-app.vercel.app" caret={t > tUrl && t < tReadme} />
          <div style={{ position: "absolute", left: 257, top: 552, font: `500 20px ${SANS}`, color: C.ink2 }}>README or notes, optional</div>
          <div style={{ position: "absolute", left: 1497, top: 538, padding: "9px 18px", borderRadius: 12, border: `1.5px solid ${C.lineStrong}`, font: `500 19px ${SANS}`, color: C.ink }}>Upload README</div>
          <div style={{ position: "absolute", left: TA.x, top: TA.y, width: TA.w, height: TA.h, borderRadius: 12, border: `1.5px solid ${fileVis > 0.3 ? "#3b82e6" : C.lineStrong}`, background: fileVis > 0.3 ? "#f3f8ff" : "#fff", outline: fileVis > 0.3 ? "3px dashed rgba(59,130,230,0.35)" : undefined }}>
            {filled > 0 ? null : <div style={{ position: "absolute", left: 18, top: 16, font: `400 20px/1.6 ${MONO}`, color: C.faint }}>Paste your README, drop the file here, or list what the app does…</div>}
          </div>
          {README.map((l, i) =>
            i >= 4 ? null : (
              <div key={i} style={{ position: "absolute", left: TA.x + 18, top: TA_LINE(i), font: `400 21px/1 ${MONO}`, color: C.ink2, opacity: filled }}>
                {l}
              </div>
            ),
          )}
          <div style={{ position: "absolute", left: 257, top: 862, font: `400 19px ${SANS}`, color: filled > 0 ? C.pass : C.muted }}>{filled > 0 ? "Loaded README.md. You can edit it below." : "Leave empty to use the README from the repository."}</div>
          <div style={{ position: "absolute", left: 257, top: 912, width: 236, height: 62, borderRadius: 40, background: C.ink, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, font: `600 21px ${SANS}`, transform: `scale(${1 - 0.04 * down})` }}>
            {spin ? <Spinner /> : null}
            Check my app
          </div>
        </div>
        {/* The two claim lines lift out of the README into cards. */}
        {[4, 5].map((li, j) => {
          const from = { x: TA.x + 6, y: TA_LINE(li) - 10, w: 1000, h: 42 };
          const to = CLAIM_ROWS[j];
          const p = clamp01(lift * 1.15 - j * 0.15);
          const x = mix(from.x, to.x, E(p));
          const y = mix(from.y, to.y, E(p));
          const w = mix(from.w, to.w, E(p));
          const h = mix(from.h, to.h, E(p));
          return (
            <div key={li} style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: mix(6, 18, p), background: `rgba(248,250,252,${p})`, border: `1.5px solid rgba(227,233,241,${p})`, opacity: filled }}>
              <div style={{ position: "absolute", left: mix(12, 132, E(p)), top: mix(10, 28, E(p)), font: `${p > 0.5 ? 500 : 400} ${mix(21, 28, E(p))}px/1 ${p > 0.5 ? SANS : MONO}`, color: C.ink, whiteSpace: "nowrap" }}>
                {p > 0.5 ? README[li].slice(2) : README[li]}
              </div>
            </div>
          );
        })}
      </div>
      {fileVis > 0 ? (
        <div style={{ position: "absolute", left: fp[0] - 44, top: fp[1] - 56, width: 88, height: 112, borderRadius: 10, background: "#fff", boxShadow: "0 18px 40px rgba(10,30,70,0.3)", opacity: fileVis, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: 12, transform: `rotate(${-6 * (1 - ramp(t, tReadme, drop))}deg)` }}>
          <div style={{ position: "absolute", top: 16, left: 14, right: 14, height: 4, background: C.line, boxShadow: `0 12px 0 ${C.line}, 0 24px 0 ${C.line}, 0 36px 0 ${C.line}` }} />
          <span style={{ font: `600 14px ${SANS}`, color: C.ink2 }}>README.md</span>
        </div>
      ) : null}
      <Cursor x={cur[0]} y={cur[1]} down={down} opacity={ramp(t, 6.3, 6.6) * (1 - ramp(t, 10.2, 10.6))} />
      <Ripple x={cur[0]} y={cur[1]} t={t} at={tClick} />
      <Typing start={tRepo} text={REPO} cps={30} />
      <Typing start={tUrl} text={URL} cps={30} />
      <Sfx at={drop} name="tick" volume={0.35} />
      <Sfx at={tClick} name="click" volume={0.45} />
    </AbsoluteFill>
  );
}

function Spinner({ color = "#fff" }: { color?: string }) {
  const t = useT();
  return <span style={{ width: 18, height: 18, borderRadius: 18, border: `2.5px solid ${color}`, borderTopColor: "transparent", transform: `rotate(${t * 400}deg)` }} />;
}

function Field({ x, y, w, label, value, ph, caret }: { x: number; y: number; w: number; label: string; value: string; ph: string; caret: boolean }) {
  return (
    <>
      <div style={{ position: "absolute", left: x, top: y, font: `500 20px ${SANS}`, color: C.ink2 }}>{label}</div>
      <div style={{ position: "absolute", left: x, top: y + 36, width: w, height: 64, borderRadius: 12, border: `1.5px solid ${caret ? "#3b82e6" : C.lineStrong}`, display: "flex", alignItems: "center", padding: "0 18px", font: `400 22px ${SANS}`, color: value ? C.ink : C.faint, boxShadow: caret ? "0 0 0 4px rgba(59,130,230,0.15)" : undefined }}>
        {value || ph}
        {caret ? <span style={{ width: 2, height: 28, background: C.ink, marginLeft: 2 }} /> : null}
      </div>
    </>
  );
}

// ================================================================== 4. Claims

const RUN = { x: 1229, y: 680, w: 300, h: 72 };
export function Claims() {
  const t = useT();
  const tSub = say("claims", "a claim it can test");
  const tChoose = say("claims", "You choose");
  const off = tChoose + 0.7;
  const on = tChoose + 1.9;
  const tCost = say("claims", "see exactly what");
  const tRun = say("claims", "Nothing runs");
  const tClick = voEnd("claims") + 0.25;
  const expand = ramp(t, tClick + 0.15, tClick + 1.25, EIO);
  const sw2 = t < off ? 1 : t < on ? 0 : 1;
  const count = Math.round(94 * ramp(t, tCost, tCost + 1.1));
  const cur = path(t, [
    [tChoose - 0.2, 1300, 1150],
    [off - 0.15, 432, 545],
    [on + 0.4, 434, 547],
    [tRun + 0.9, 1380, 712],
    [tClick + 1, 1381, 713],
  ]);
  const down = Math.max(press(t, off), press(t, on), press(t, tClick));
  const rows = [
    { n: "01", text: "Users can add items to the cart and the cart count goes up", sub: "Kane will open the shop, click Add item, and check the count goes up." },
    { n: "02", text: "Users can subscribe to the newsletter and see a confirmation", sub: "Kane will enter an email, click Subscribe, and look for a confirmation." },
  ];
  // The Run button grows into the dark stage where Kane works.
  const bx = mix(RUN.x, 0, expand),
    by = mix(RUN.y, 0, expand),
    bw = mix(RUN.w, 1920, expand),
    bh = mix(RUN.h, 1080, expand);
  return (
    <AbsoluteFill>
      <Sky drift={t + 25} />
      <Nav />
      <div style={{ position: "absolute", left: 360, top: 118, font: `500 26px ${SANS}`, color: "rgba(255,255,255,0.88)", opacity: ramp(t, 0.1, 0.8) }}>Step 2</div>
      <div style={{ position: "absolute", left: 356, top: 150, font: `700 62px/1 ${SANS}`, color: "#fff", letterSpacing: -1.5, opacity: ramp(t, 0.1, 0.8) }}>Choose what Kane checks</div>
      <div style={{ opacity: ramp(t, 0, 0.6) }}>
        <Panel x={360} y={250} w={1200} h={540} top="Claims" right={`${sw2 ? 2 : 1} of 2 on`}>
          <div />
        </Panel>
      </div>
      {rows.map((r, i) => {
        const b = CLAIM_ROWS[i];
        const active = i === 0 ? 1 : sw2;
        return (
          <div key={i} style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 18, background: "#f8fafc", border: `1.5px solid ${C.line}`, opacity: mix(0.5, 1, active) }}>
            <div style={{ position: "absolute", left: 24, top: 26, width: 64, height: 36, borderRadius: 36, background: active ? C.passDot : C.lineStrong, opacity: ramp(t, 0.2, 0.7) }}>
              <div style={{ position: "absolute", top: 4, left: active ? 32 : 4, width: 28, height: 28, borderRadius: 28, background: "#fff", boxShadow: "0 2px 4px rgba(0,0,0,0.15)" }} />
            </div>
            <div style={{ position: "absolute", left: 132, top: 28, font: `500 28px/1 ${SANS}`, color: C.ink, whiteSpace: "nowrap" }}>{r.text}</div>
            <div style={{ position: "absolute", left: 132, top: 74, font: `400 21px ${SANS}`, color: C.muted, opacity: ramp(t, tSub + i * 0.3, tSub + 0.6 + i * 0.3) }}>{r.sub}</div>
            <div style={{ position: "absolute", right: 24, top: 28, font: `400 18px ${MONO}`, color: C.faint, opacity: ramp(t, 0.2, 0.7) }}>{r.n}</div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 391, top: 660, opacity: ramp(t, tCost - 0.3, tCost + 0.2) }}>
        <div style={{ font: `500 21px ${SANS}`, color: C.muted }}>This run costs</div>
        <div style={{ font: `700 50px/1.1 ${SANS}`, color: C.ink, letterSpacing: -1 }}>
          {count} <span style={{ fontSize: 26, fontWeight: 500, color: C.muted }}>Kane credits</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: bx, top: by, width: bw, height: bh, borderRadius: mix(40, 0, expand), background: `rgb(${mix(20, 17, expand)},${mix(26, 22, expand)},${mix(34, 30, expand)})`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 14, font: `600 24px ${SANS}`, transform: `scale(${1 - 0.04 * press(t, tClick) * (1 - expand)})`, opacity: ramp(t, tCost, tCost + 0.5) }}>
        <span style={{ opacity: 1 - ramp(t, tClick + 0.1, tClick + 0.5) }}>
          Run <span style={{ color: C.faint, fontWeight: 500 }}>{count} credits</span>
        </span>
      </div>
      <Cursor x={cur[0]} y={cur[1]} down={down} opacity={ramp(t, tChoose - 0.2, tChoose + 0.2) * (1 - ramp(t, tClick + 0.2, tClick + 0.5))} />
      <Ripple x={cur[0]} y={cur[1]} t={t} at={off} />
      <Ripple x={cur[0]} y={cur[1]} t={t} at={on} />
      <Sfx at={off} name="click" volume={0.4} />
      <Sfx at={on} name="click" volume={0.4} />
      <Sfx at={tClick} name="click" volume={0.5} />
    </AbsoluteFill>
  );
}

// ================================================================== 5. Kane CLI tests it

const BR = { x: 210, y: 90, w: 1500, h: 900 };
const PAGE_Y = BR.y + 64;
const shopPt = (p: { x: number; y: number }): [number, number] => [BR.x + p.x, PAGE_Y + p.y];

/** The dive from the Kane chip into the browser: 0 board, 1 browser. */
function Dive({ t, at, children, timer0 = 0, pills, draw = 1, hudIn = 1, veil = 0 }: { t: number; at: number; children: React.ReactNode; timer0?: number; pills?: React.ReactNode; draw?: number; hudIn?: number; veil?: number }) {
  const z = ramp(t, at, at + 1.0, EIO);
  const k = mix(1, 9, z);
  const show = ramp(t, at + 0.55, at + 1.25);
  return (
    <>
      <div style={{ position: "absolute", inset: 0, transformOrigin: `${CHIP.x}px ${CHIP.y}px`, transform: `scale(${k})`, opacity: 1 - ramp(t, at + 0.35, at + 0.8) }}>
        <Board t={t} draw={draw} timer={t - timer0} hud={(1 - z) * hudIn} veil={veil} />
        {pills}
      </div>
      <div style={{ position: "absolute", inset: 0, transformOrigin: `${CHIP.x}px ${CHIP.y}px`, transform: `scale(${mix(0.18, 1, E(show))})`, opacity: show }}>{children}</div>
    </>
  );
}

function KaneTag() {
  return (
    <div style={{ marginLeft: 18, display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderRadius: 10, background: C.ink, color: "#fff", font: `600 18px ${SANS}` }}>
      <span style={{ width: 9, height: 9, borderRadius: 9, background: C.passDot }} />
      Kane CLI is testing your live app
    </div>
  );
}

export function Kane() {
  const t = useT();
  const draw = ramp(t, 0.2, 2.0, EIO);
  const tHand = say("kane", "Greenlight hands it");
  const tOpen = say("kane", "Kane opens") - 0.2;
  const tWay = say("kane", "the way a person would");
  const tClicks = say("kane", "it clicks");
  const tTypes = say("kane", "it types");
  const tReads = say("kane", "it reads");
  const tWorks = say("kane", "The cart works");
  const tSub1 = say("kane", "But the newsletter") + 0.15;
  const tSub2 = say("kane", "saying no") + 0.35;
  const err1 = tSub1 + 0.35;
  const err2 = tSub2 + 0.35;
  const EMAIL = "ada@example.com";
  const emailStart = tTypes + 0.25;
  const add = shopPt(SHOP.add);
  const em = shopPt(SHOP.email);
  const sb = shopPt(SHOP.subscribe);
  const cur = path(t, [
    [tOpen + 1.2, 1500, 900],
    [tWay, 760, 210],
    [tClicks - 0.2, add[0], add[1]],
    [tTypes - 0.15, em[0], em[1]],
    [tReads + 0.1, 760, 360],
    [tSub1 - 0.15, sb[0], sb[1]],
    [tSub2 + 1, sb[0] + 2, sb[1] + 2],
  ]);
  const down = Math.max(press(t, tClicks), press(t, tTypes), press(t, tSub1), press(t, tSub2));
  const count = t > tClicks + 0.12 ? 1 : 0;
  const showErr = (t > err1 && t < tSub2) || t > err2;
  const errP = t > err2 ? ramp(t, err2, err2 + 0.25) : ramp(t, err1, err1 + 0.25);
  // Zoom into the error until it matches Kane's quote in the verdict (scene 6 opens there).
  const zf = ramp(t, 21.4, 24.4, EIO);
  const errW = measure("Subscription failed. Please try again later.", `400 28px ${SITE}`);
  const P = { x: BR.x + SHOP.result.x + errW / 2, y: PAGE_Y + 640 + 14 };
  const Z = (24 * Q_K) / 28;
  const z = mix(1, Z, zf);
  const tx = mix(0, 960 - P.x * Z, zf);
  const ty = mix(0, 540 - P.y * Z, zf);
  const others = 1 - ramp(t, 22.2, 23.6);
  const pills = (
    <>
      {["Add items to the cart", "Subscribe to the newsletter"].map((label, i) => {
        const a = tHand + 0.2 + i * 0.45;
        const p = ramp(t, a, a + 1.5, EIO);
        const from = i === 0 ? [330, 230] : [1590, 760];
        const x = mix(from[0], CHIP.x, p);
        const y = mix(from[1], CHIP.y, p);
        const s = mix(1, 0.15, ramp(t, a + 0.9, a + 1.5));
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%,-50%) scale(${s})`, opacity: ramp(t, a, a + 0.3) * (1 - ramp(t, a + 1.25, a + 1.5)), padding: "14px 24px", borderRadius: 14, background: "#fff", color: C.ink, font: `600 24px ${SANS}`, whiteSpace: "nowrap", boxShadow: "0 12px 30px rgba(0,0,0,0.4)" }}>
            {label}
          </div>
        );
      })}
    </>
  );
  return (
    <AbsoluteFill style={{ background: "#0b0f15" }}>
      <div style={{ position: "absolute", inset: 0 }}>
        <Dive t={t} at={tOpen} pills={pills} draw={draw} hudIn={ramp(t, 1.2, 1.9)} timer0={0.8} veil={1 - ramp(t, 0, 1.4)}>
          <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: zf }} />
          <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${z})` }}>
            <div style={{ opacity: others }}>
              <Browser x={BR.x} y={BR.y} w={BR.w} h={BR.h} url="greenlight-demo-shop.vercel.app" tag={<KaneTag />}>
                <DemoShop count={count} email={typed(EMAIL, t, emailStart, 16)} caret={t > tTypes && t < tReads} scan={ramp(t, tReads + 0.3, tReads + 1.6, (x) => x)} cartOk={ramp(t, tWorks, tWorks + 0.4)} />
              </Browser>
            </div>
            {showErr ? <div style={{ position: "absolute", left: BR.x + SHOP.result.x, top: PAGE_Y + 640, font: `400 28px/1 ${SITE}`, color: C.fail, opacity: errP, whiteSpace: "nowrap" }}>{ERR}</div> : null}
          </div>
          <Cursor x={cur[0]} y={cur[1]} down={down} label="Kane CLI" opacity={ramp(t, tOpen + 1.2, tOpen + 1.6) * (1 - ramp(t, 21.2, 21.7))} />
          <Ripple x={cur[0]} y={cur[1]} t={t} at={tClicks} />
          <Ripple x={cur[0]} y={cur[1]} t={t} at={tSub1} />
          <Ripple x={cur[0]} y={cur[1]} t={t} at={tSub2} />
        </Dive>
      </div>
      <Sfx at={tHand + 1.6} name="tick" volume={0.3} />
      <Sfx at={tHand + 2.05} name="tick" volume={0.3} />
      <Sfx at={tClicks} name="click" volume={0.45} />
      <Sfx at={tTypes} name="click" volume={0.4} />
      <Typing start={emailStart} text={EMAIL} cps={16} />
      <Sfx at={tSub1} name="click" volume={0.45} />
      <Sfx at={err1} name="fail" volume={0.55} />
      <Sfx at={tSub2} name="click" volume={0.45} />
    </AbsoluteFill>
  );
}

// ================================================================== 6. The verdict

/** Camera zoom on Kane's quote at the start of scene 6 (scene 5 ends on the same frame). */
const Q_K = 2.4;
const quoteCenter = () => ({ x: RP.quote.x + measure("Subscription failed. Please try again later.", QUOTE_FONT) / 2, y: RP.quote.y });

export const CARD_CAM = { x: 1450, y: 545, k: 2.0 };

export function Verdict() {
  const t = useT();
  const q = quoteCenter();
  const pull = ramp(t, 0.6, 3.0, EIO);
  const tCart = say("verdict", "The cart passed");
  const tFail = say("verdict", "The newsletter failed");
  const tSaw = say("verdict", "exactly what it saw");
  const tStop = say("verdict", "doesn't stop");
  const tFix = say("verdict", "It brings up the fix");
  const push = ramp(t, 16.3, 18.8, EIO);
  const intro = ramp(t, 0.25, 1.4);
  const cx = mix(mix(q.x, 960, pull), CARD_CAM.x, push);
  const cy = mix(mix(q.y, 590, pull), CARD_CAM.y, push);
  const k = mix(mix(Q_K, 0.95, pull), CARD_CAM.k, push);
  const s: ResultState = {
    ...RS0,
    noteVis: 1,
    cart: ramp(t, tCart, tCart + 0.5),
    news: ramp(t, tFail, tFail + 0.5),
    head: ramp(t, tFail, tFail + 0.6),
    pill: ramp(t, tFail, tFail + 0.6),
    note: ramp(t, tSaw, tSaw + 0.5) * (1 - ramp(t, tStop, tStop + 0.6)),
    fix: ramp(t, tStop, tStop + 0.5),
    card: ramp(t, tFix, tFix + 0.6),
  };
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      <Sky drift={t + 39} />
      <div style={camera(cx, cy, k)}>
        <ResultWorld s={s} drift={t + 39} />
        <div style={{ position: "absolute", left: -3000, top: -3000, width: 8000, height: 8000, background: "#fff", opacity: 1 - intro }} />
        <div style={{ position: "absolute", left: RP.quote.x, top: RP.quote.y - 12, font: QUOTE_FONT, lineHeight: 1, color: C.fail, whiteSpace: "nowrap", opacity: 1 - intro }}>{QUOTE}</div>
      </div>
      <Sfx at={tCart} name="tick" volume={0.3} />
      <Sfx at={tFail} name="fail" volume={0.35} />
    </AbsoluteFill>
  );
}

// ================================================================== 7. First time: install

const TERM_FULL = { x: 120, y: 64, w: 1680, h: 950 };
const TERM_HALF = { x: 1000, y: 120, w: 820, h: 840 };
export const SPLIT_CAM = { x: 1770, y: 640, k: 1.5 };

export function Install() {
  const t = useT();
  const tFirst = say("install", "First time");
  const tCopy = say("install", "Copy one line");
  const tReady = say("install", "Claude Code is ready");
  const open = ramp(t, tFirst + 0.7, tFirst + 1.4, EIO);
  const glide = ramp(t, tFirst + 1.0, tFirst + 2.4, EIO);
  const split = ramp(t, 10.6, 12.6, EIO);
  const cx = mix(CARD_CAM.x, SPLIT_CAM.x, split);
  const cy = mix(mix(CARD_CAM.y, 760, glide), SPLIT_CAM.y, split);
  const k = mix(CARD_CAM.k, SPLIT_CAM.k, split);
  const toScreen = (x: number, y: number): [number, number] => [960 + (x - cx) * k, 540 + (y - cy) * k];
  const clickInstall = tFirst + 0.55;
  const copyAt = tCopy + 0.2;
  const instPt = toScreen(RP.install.x, RP.install.y);
  const copyPt = toScreen(1631, 812);
  const cur = path(t, [
    [0.2, 1400, 1150],
    [clickInstall - 0.1, instPt[0], instPt[1]],
    [clickInstall + 0.6, instPt[0] + 40, instPt[1] + 40],
    [copyAt - 0.1, copyPt[0], copyPt[1]],
    [copyAt + 1, copyPt[0] + 2, copyPt[1] + 2],
  ]);
  const down = Math.max(press(t, clickInstall), press(t, copyAt));
  const rise = ramp(t, tReady - 0.6, tReady + 0.6, EIO);
  const tr = {
    x: mix(260, TERM_HALF.x, split),
    y: mix(mix(1120, 130, rise), TERM_HALF.y, split),
    w: mix(1400, TERM_HALF.w, split),
    h: mix(820, TERM_HALF.h, split),
  };
  const s: ResultState = { ...RS0, cart: 1, news: 1, head: 1, pill: 1, card: 1 - ramp(t, 0, 1), fix: 1 - ramp(t, 0, 1), install: open, installCopied: t > copyAt + 0.1 ? 1 : 0 };
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      <Sky drift={t + 58} />
      <div style={camera(cx, cy, k)}>
        <ResultWorld s={s} drift={t + 58} />
      </div>
      <Cursor x={cur[0]} y={cur[1]} down={down} opacity={1 - ramp(t, copyAt + 0.6, copyAt + 1)} />
      <Ripple x={cur[0]} y={cur[1]} t={t} at={clickInstall} />
      <Ripple x={cur[0]} y={cur[1]} t={t} at={copyAt} />
      {rise > 0 ? (
        <Terminal {...tr}>
          <Welcome />
          <Prompt dim={'Try "fix the failing claim"'} />
        </Terminal>
      ) : null}
      <Sfx at={clickInstall} name="click" volume={0.4} />
      <Sfx at={copyAt} name="click" volume={0.4} />
      <Sfx at={copyAt + 0.12} name="tick" volume={0.25} />
    </AbsoluteFill>
  );
}

// ================================================================== 8. One paste

const PASTED = (
  <>
    Use Greenlight to fix my app until Kane CLI passes every claim. <span style={{ color: "#8b93a1" }}>[Pasted text +4 lines]</span>
  </>
);

export function Paste() {
  const t = useT();
  const cam = SPLIT_CAM;
  const toScreen = (x: number, y: number): [number, number] => [960 + (x - cam.x) * cam.k, 540 + (y - cam.y) * cam.k];
  const tClick = say("paste", "click Connect") + 0.45;
  const tCopy = say("paste", "copy one message") + 0.25;
  const tPaste = say("paste", "paste it into") + 0.35;
  const tEnter = voEnd("paste") + 0.2;
  const con = toScreen(RP.connect.x, RP.connect.y);
  const cp = toScreen(RP.copy.x, RP.copy.y);
  const cur = path(t, [
    [0.1, 700, 1150],
    [tClick - 0.1, con[0], con[1]],
    [tCopy - 0.1, cp[0], cp[1]],
    [tCopy + 1, cp[0] + 4, cp[1] + 4],
  ]);
  const down = Math.max(press(t, tClick), press(t, tCopy));
  const fly = ramp(t, tCopy + 0.3, tPaste, EIO);
  const pasted = t > tPaste;
  const sent = ramp(t, tEnter, tEnter + 0.5);
  const full = ramp(t, 11.4, 13, EIO);
  const tr = {
    x: mix(TERM_HALF.x, TERM_FULL.x, full),
    y: mix(TERM_HALF.y, TERM_FULL.y, full),
    w: mix(TERM_HALF.w, TERM_FULL.w, full),
    h: mix(TERM_HALF.h, TERM_FULL.h, full),
  };
  const fx = mix(cp[0], TERM_HALF.x + 120, fly);
  const fy = mix(cp[1], TERM_HALF.y + 360, fly);
  const s: ResultState = { ...RS0, cart: 1, news: 1, head: 1, pill: 1, install: 1, installCopied: 1, connect: ramp(t, tClick + 0.1, tClick + 0.7), copied: t > tCopy + 0.1 ? 1 : 0 };
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      <Sky drift={t + 71} />
      <div style={{ position: "absolute", inset: 0, transform: `translateX(${-1000 * full}px)` }}>
        <div style={camera(cam.x, cam.y + 30 * ramp(t, tClick, tClick + 0.8), cam.k)}>
          <ResultWorld s={s} drift={t + 71} />
        </div>
      </div>
      <Terminal {...tr} size={mix(22, 27, full)}>
        {sent > 0 ? (
          <div style={{ background: "#25282e", borderRadius: 8, padding: "10px 16px", opacity: sent, color: "#c9ced6" }}>
            &gt; {PASTED}
          </div>
        ) : (
          <Welcome />
        )}
        {sent > 0 ? (
          <div style={{ marginTop: 18, color: ORANGE, opacity: ramp(t, tEnter + 0.3, tEnter + 0.6) }}>
            {"✢✳✶✻✽"[Math.floor(t * 8) % 5]} <span style={{ color: "#e6e8eb" }}>Reading Kane's verdict…</span>
          </div>
        ) : (
          <Prompt text={pasted ? PASTED : undefined} dim={pasted ? undefined : 'Try "fix the failing claim"'} />
        )}
      </Terminal>
      {fly > 0 && fly < 1 ? (
        <div style={{ position: "absolute", left: fx, top: fy, transform: "translate(-50%,-50%)", padding: "12px 20px", borderRadius: 12, background: C.ink, color: "#fff", font: `600 20px ${SANS}`, boxShadow: "0 16px 36px rgba(0,0,0,0.35)", opacity: Math.min(1, fly * 5, (1 - fly) * 5) }}>
          Message copied
        </div>
      ) : null}
      <Cursor x={cur[0]} y={cur[1]} down={down} opacity={1 - ramp(t, tCopy + 0.5, tCopy + 0.9)} />
      <Ripple x={cur[0]} y={cur[1]} t={t} at={tClick} />
      <Ripple x={cur[0]} y={cur[1]} t={t} at={tCopy} />
      <Sfx at={tClick} name="click" volume={0.45} />
      <Sfx at={tCopy} name="click" volume={0.4} />
      <Sfx at={tCopy + 0.12} name="tick" volume={0.25} />
      <Sfx at={tPaste} name="type" volume={0.4} />
      <Sfx at={tEnter} name="click" volume={0.45} />
    </AbsoluteFill>
  );
}

// ================================================================== 9. Claude Code fixes it

export function Fix() {
  const t = useT();
  const a = say("fix", "Claude Code reads") - 0.2;
  const aRes = say("fix", "including what Kane saw") - 0.3;
  const b = say("fix", "It uses that") - 0.1;
  const c = say("fix", "the form was misreading") - 0.2;
  const d = say("fix", "It fixes it") - 0.1;
  const e = say("fix", "waits for the new version") - 0.1;
  const eDone = e + 2.6;
  const f = say("fix", "asks Kane to check again") - 0.1;
  const g = say("fix", "You just watch") + 0.3;
  const morph = ramp(t, 24.6, 26.6, EIO);
  const tr = {
    x: mix(TERM_FULL.x, CHIP.x - CHIP.w / 2, morph),
    y: mix(TERM_FULL.y, CHIP.y - CHIP.h / 2, morph),
    w: mix(TERM_FULL.w, CHIP.w, morph),
    h: mix(TERM_FULL.h, CHIP.h, morph),
  };
  const spinner = (label: string, from: number) => (
    <div style={{ marginTop: 18, color: ORANGE }}>
      {"✢✳✶✻✽"[Math.floor(t * 8) % 5]} <span style={{ color: "#e6e8eb" }}>{label}</span> {from > -50 ? <span style={{ color: "#6b7380" }}>({Math.max(0, Math.floor(t - from))}s)</span> : null}
    </div>
  );
  const busy = t > g ? spinner("Kane is checking again…", g) : t < a ? spinner("Reading Kane's verdict…", -99) : null;
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      <Sky drift={t + 84} />
      <div style={{ position: "absolute", inset: 0, opacity: morph }}>
        <Board t={t} timer={t - 27} hud={ramp(t, 26, 26.8)} />
      </div>
      <Terminal {...tr} size={27} radius={mix(18, 40, morph)} opacity={1 - ramp(t, 26.1, 26.9)}>
        <div style={{ opacity: 1 - ramp(t, 24.4, 25.2) }}>
          <div style={{ background: "#25282e", borderRadius: 8, padding: "10px 16px", color: "#c9ced6" }}>&gt; {PASTED}</div>
          <Msg p={ramp(t, a, a + 0.5)} sub={t > aRes ? <div style={{ opacity: ramp(t, aRes, aRes + 0.4) }}><span style={{ color: C.passDot }}>✓</span> Cart: passed<br /><span style={{ color: C.failDot }}>✗</span> Newsletter: failed. Kane saw every sign-up say "Subscription failed."</div> : null}>
            Reading Kane's verdict from Greenlight.
          </Msg>
          <Msg p={ramp(t, b, b + 0.5)}>Looking at the sign-up form.</Msg>
          <Msg p={ramp(t, c, c + 0.5)} sub={t > c + 1.1 ? (
            <div style={{ opacity: ramp(t, c + 1.1, c + 1.5), border: "1px solid #343943", borderRadius: 8, overflow: "hidden", fontSize: 23, marginTop: 6, width: 720 }}>
              <div style={{ padding: "4px 12px", color: "#8b93a1", background: "#1e2126" }}>app.js</div>
              <div style={{ padding: "2px 12px", background: "rgba(239,90,60,0.16)", color: "#f1a99a" }}>-   if (res.status === "ok") {"{"}</div>
              <div style={{ padding: "2px 12px", background: "rgba(34,179,107,0.16)", color: "#9fe3bf" }}>+   if (res.ok) {"{"}</div>
            </div>
          ) : null}>
            Found it: the form misreads the server's reply, so every sign-up looks like a failure.
          </Msg>
          <Msg p={ramp(t, d, d + 0.5)}>Fixed. Saving the change and publishing it.</Msg>
          <Msg p={ramp(t, e, e + 0.5)} done={t > eDone} sub={t > eDone ? <span style={{ opacity: ramp(t, eDone, eDone + 0.3) }}>The new version is live.</span> : null}>
            Waiting for the new version to go live{t > eDone ? "." : "…"}
          </Msg>
          <Msg p={ramp(t, f, f + 0.5)}>Asking Greenlight to have Kane check again.</Msg>
          {busy}
        </div>
      </Terminal>
      <Sfx at={c + 1.1} name="tick" volume={0.22} />
      <Sfx at={eDone} name="tick" volume={0.22} />
    </AbsoluteFill>
  );
}

// ================================================================== 10. Kane checks again

export function Again() {
  const t = useT();
  const dive = 1.5;
  const tTests = say("again", "Kane tests the new version");
  const tWorks = say("again", "This time it works") - 0.1;
  const tPass = say("again", "Every claim passes");
  const tFound = say("again", "Claude Code fixed it");
  const EMAIL = "ada@example.com";
  const typeAt = tTests + 0.15;
  const subAt = tWorks - 0.45;
  const em = shopPt(SHOP.email);
  const sb = shopPt(SHOP.subscribe);
  const cur = path(t, [
    [dive + 1.0, 1500, 900],
    [typeAt - 0.2, em[0], em[1]],
    [subAt - 0.15, sb[0], sb[1]],
    [subAt + 2, sb[0] + 2, sb[1] + 2],
  ]);
  const down = Math.max(press(t, typeAt - 0.1), press(t, subAt));
  const out = ramp(t, tPass - 1.1, tPass - 0.65, EIO);
  const toPage = ramp(t, tPass - 0.7, tPass - 0.15, EIO);
  const flip = ramp(t, tPass, tPass + 0.6);
  const dots = ramp(t, 15.4, 16.4);
  const glide = ramp(t, 16.4, 18.6, EIO);
  const cam = { x: 960, y: 560, k: 1 };
  const dotScreen = [960 + (RP.dot.x - cam.x) * cam.k, 540 + (RP.dot.y - cam.y) * cam.k];
  const dx = mix(dotScreen[0], 960, glide);
  const dy = mix(dotScreen[1], 540, glide);
  const dr = mix(7, 18, glide);
  const s: ResultState = { ...RS0, cart: 1, news: 1, head: 1, pill: 1, newsPass: flip, headPass: flip, dotOnly: dots };
  const toast = ramp(t, tFound - 0.2, tFound + 0.4) * (1 - dots);
  return (
    <AbsoluteFill style={{ background: "#0b0f15" }}>
      <div style={{ position: "absolute", inset: 0, opacity: 1 - out, transform: `scale(${mix(1, 0.94, out)})` }}>
        <Dive t={t} at={dive} timer0={0}>
          <Browser x={BR.x} y={BR.y} w={BR.w} h={BR.h} url="greenlight-demo-shop.vercel.app" tag={<KaneTag />}>
            <DemoShop count={0} email={typed(EMAIL, t, typeAt, 18)} caret={t > typeAt - 0.1 && t < subAt} result={t > tWorks ? { kind: "ok", text: OK } : undefined} resultP={ramp(t, tWorks, tWorks + 0.3)} />
          </Browser>
          <Cursor x={cur[0]} y={cur[1]} down={down} label="Kane CLI" opacity={ramp(t, dive + 1.0, dive + 1.4)} />
          <Ripple x={cur[0]} y={cur[1]} t={t} at={subAt} />
        </Dive>
      </div>
      {toPage > 0 ? (
        <div style={{ position: "absolute", inset: 0, opacity: toPage, transform: `scale(${mix(1.04, 1, toPage)})` }}>
          <Sky drift={t + 111} />
          <div style={camera(cam.x, cam.y, cam.k)}>
            <ResultWorld s={{ ...s, pill: 0, noDot: true }} drift={t + 111} />
          </div>
          {/* The Passed pill and its dot, drawn here so the dot can travel. */}
          <div style={{ position: "absolute", left: 1530, top: 176 - 20, height: 52, padding: "0 24px 0 48px", borderRadius: 14, border: "1.5px solid rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", font: `600 22px ${SANS}`, color: "#fff", opacity: 1 - dots }}>
            {flip > 0.5 ? "Passed" : "Failed"}
          </div>
          <div style={{ position: "absolute", left: dx - dr, top: dy - dr, width: dr * 2, height: dr * 2, borderRadius: "50%", background: flip > 0.5 ? C.passDot : C.failDot, boxShadow: `0 0 ${30 * glide}px rgba(126,240,168,${0.6 * glide})` }} />
          <div style={{ position: "absolute", left: 1220, top: 860, width: 560, padding: "18px 24px", borderRadius: 16, background: "#17191d", border: "1px solid #2a2e35", font: `400 20px/1.5 ${MONO}`, color: "#e6e8eb", opacity: toast, transform: `translateY(${16 * (1 - toast)}px)`, boxShadow: "0 24px 50px rgba(5,15,35,0.4)" }}>
            <span style={{ color: C.passDot }}>⏺</span> Kane passed every claim. Done.
          </div>
        </div>
      ) : null}
      <Sfx at={typeAt - 0.1} name="click" volume={0.4} />
      <Typing start={typeAt} text={EMAIL} cps={18} />
      <Sfx at={subAt} name="click" volume={0.45} />
      <Sfx at={tWorks} name="tick" volume={0.3} />
      <Sfx at={tPass} name="pass" volume={0.55} />
    </AbsoluteFill>
  );
}

// ================================================================== 11. Close

export function Close() {
  const t = useT();
  const grow = ramp(t, 0.2, 1.1);
  const draw = ramp(t, 0.5, 1.5, EIO);
  const lock = ramp(t, 1.3, 2.4, EIO);
  const M0 = 216,
    M1 = 150;
  const WH1 = 104;
  const ww1 = (WH1 * 4925) / 1100;
  const lockLeft = 960 - (M1 + 28 + ww1) / 2;
  const lockTop = 250;
  const st = markAt(960, 540, M0);
  const m = mix(M0, M1, lock);
  const mx = mix(st.left, lockLeft, lock);
  const my = mix(st.top, lockTop, lock);
  const tSteps = say("close", "Kane CLI checks");
  const tKeeps = say("close", "Claude Code keeps");
  const tTry = say("close", "Try it");
  const steps = [
    { t: "Check", s: "Kane CLI" },
    { t: "Verdict", s: "Greenlight" },
    { t: "Fix", s: "Claude Code" },
    { t: "Check again", s: "Kane CLI" },
  ];
  const fadeOut = ramp(t, 15.4, 17.8, EIO);
  const travel = ((t - tSteps) / 3) % 1;
  return (
    <AbsoluteFill>
      <Sky drift={t + 131} bank bankOpacity={0.95 * ramp(t, 0.8, 3)} />
      <div style={{ position: "absolute", left: mx, top: my }}>
        <Mark size={m} tile={grow} draw={draw} />
      </div>
      <div style={{ position: "absolute", left: mx + m + 28, top: my + (m - WH1) / 2 }}>
        <Wordmark height={WH1} reveal={ramp(t, 1.6, 2.6, EIO)} />
      </div>
      <div style={{ position: "absolute", left: 360, width: 1200, top: 540, height: 130 }}>
        <div style={{ position: "absolute", left: 120, right: 120, top: 36, height: 2, background: "rgba(255,255,255,0.55)", transformOrigin: "0 0", transform: `scaleX(${ramp(t, tSteps, tSteps + 1.6, EIO)})` }} />
        {t > tSteps + 1.6 ? <div style={{ position: "absolute", left: 120 + 960 * travel - 7, top: 30, width: 14, height: 14, borderRadius: 14, background: C.lamp, boxShadow: "0 0 14px rgba(126,240,168,0.9)" }} /> : null}
        {steps.map((s, i) => {
          const p = ramp(t, tSteps + i * 0.35, tSteps + i * 0.35 + 0.6);
          const hi = i === 2 ? ramp(t, tKeeps, tKeeps + 0.5) : 0;
          return (
            <div key={i} style={{ position: "absolute", left: i * 320, width: 240, top: 0, textAlign: "center", opacity: p, transform: `translateY(${12 * (1 - p)}px)` }}>
              <div style={{ display: "inline-block", padding: "12px 24px", borderRadius: 14, background: hi > 0 ? `rgba(255,255,255,${mix(0.2, 0.95, hi)})` : "rgba(255,255,255,0.2)", border: "1.5px solid rgba(255,255,255,0.6)", color: hi > 0.5 ? C.ink : "#fff", font: `600 26px ${SANS}`, whiteSpace: "nowrap" }}>{s.t}</div>
              <div style={{ marginTop: 14, font: `500 21px ${SANS}`, color: "rgba(255,255,255,0.88)" }}>{s.s}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 750, display: "flex", justifyContent: "center", gap: 20, opacity: ramp(t, tTry, tTry + 0.6), transform: `translateY(${12 * (1 - ramp(t, tTry, tTry + 0.6))}px)` }}>
        <div style={{ padding: "16px 30px", borderRadius: 16, background: "#fff", color: C.blueInk, font: `600 28px ${SANS}` }}>greenlight-api-xi.vercel.app</div>
        <div style={{ padding: "16px 30px", borderRadius: 16, background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.6)", color: "#fff", font: `600 28px ${SANS}` }}>github.com/XDGram/GREENLIGHT</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 860, textAlign: "center", font: `500 24px ${SANS}`, color: "rgba(255,255,255,0.9)", opacity: ramp(t, tTry + 0.8, tTry + 1.4) }}>Built with Kane CLI and Claude Code</div>
      <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: fadeOut }} />
    </AbsoluteFill>
  );
}

export const _unused = { keys, Tick };
