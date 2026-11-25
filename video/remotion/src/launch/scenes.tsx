import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, staticFile } from "remotion";
import { clamp01, E, EIO, mix, ramp, typed, useT } from "../lib";
import { say, voEnd } from "../timeline";
import { along, APP, camAt, Camera, Card, center, ClickRing, frame, GRAY, INK, Keys, LINE, MONO, OVER, pageBox, pageToStage, Pointer, press, S, SANS, SHOP, Sfx, spread, Stage, stepImage, Tag, WIN, Window, Words, type Cam } from "./kit";

const APP_URL = "greenlight-api-xi.vercel.app";
const SHOP_URL = "greenlight-demo-shop.vercel.app";
const A = (state: string, el: string) => APP[state][el];
const white = (o: number) => (o > 0 ? <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: o, zIndex: 90 }} /> : null);

// ================================================================== 1. The promise

export function Promise() {
  const t = useT();
  const s0 = say("promise", "Every app has");
  const s0e = say("promise", "promises", true);
  const tAdd = say("promise", "Add to cart");
  const tSign = say("promise", "Sign up for");
  const tBut = say("promise", "But does the live app");
  const tKeep = say("promise", "keep them");
  const up = ramp(t, 3.2, 4.0, EIO);
  const awayCard = ramp(t, tBut - 0.5, tBut + 0.1, EIO);
  const thru = ramp(t, 9.7, 10.9, EIO);
  const line1 = "Every app has a README full of promises.";
  return (
    <AbsoluteFill>
      <Stage />
      {/* Headline, then it lifts to make room for the README card. */}
      <div style={{ position: "absolute", left: 60, right: 60, top: mix(460, 150, up), transform: `scale(${mix(1, 0.62, up)})`, opacity: 1 - awayCard, filter: `blur(${awayCard * 12}px)` }}>
        <Words t={t} text={line1} at={spread(7, s0 - 0.05, s0e - 0.4)} size={84} mark={["promises"]} />
      </div>
      {/* The README, as a clean document card. */}
      <div style={{ position: "absolute", left: 510, top: 330, width: 900, height: 440, perspective: 1800, opacity: 1 - awayCard, filter: `blur(${awayCard * 14}px)`, transform: `scale(${mix(1, 0.94, awayCard)})` }}>
        {(() => {
          const p = ramp(t, 3.3, 4.2);
          return (
            <div style={{ width: "100%", height: "100%", borderRadius: 24, background: "#fff", boxShadow: "0 50px 110px rgba(15,18,25,0.13), 0 12px 30px rgba(15,18,25,0.08), 0 0 0 1px rgba(15,18,25,0.06)", transform: `rotateX(${(1 - E(p)) * 28}deg) translateY(${(1 - E(p)) * 80}px)`, opacity: p, filter: `blur(${(1 - p) * 12}px)`, overflow: "hidden" }}>
              <div style={{ height: 58, borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center", gap: 10, padding: "0 30px", font: `500 19px ${SANS}`, color: GRAY }}>
                <svg width="18" height="20" viewBox="0 0 18 20"><path d="M2 1h9l5 5v13H2z" fill="none" stroke={GRAY} strokeWidth="1.6" strokeLinejoin="round" /><path d="M11 1v5h5" fill="none" stroke={GRAY} strokeWidth="1.6" /></svg>
                README.md
              </div>
              <div style={{ padding: "34px 44px" }}>
                <div style={{ font: `700 48px ${SANS}`, letterSpacing: "-0.04em", color: INK }}>Demo Shop</div>
                <div style={{ font: `400 22px ${SANS}`, color: GRAY, marginTop: 6 }}>A small store.</div>
                {[
                  ["Users can add items to the cart", tAdd],
                  ["Users can subscribe to the newsletter", tSign],
                ].map(([txt, at], i) => {
                  const h = ramp(t, (at as number) - 0.1, (at as number) + 0.35);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 18, marginTop: i ? 18 : 34, font: `500 30px ${SANS}`, letterSpacing: "-0.02em", color: h > 0 ? INK : "#b4b8bf" }}>
                      <svg width="34" height="34" viewBox="0 0 34 34">
                        <circle cx="17" cy="17" r="15" fill={h > 0 ? INK : "none"} stroke={h > 0 ? INK : "#d5d8dd"} strokeWidth="2" style={{ transformOrigin: "17px 17px", transform: `scale(${mix(0.7, 1, E(h))})` }} />
                        <path d="M10 17.5l4.5 4.5L24 12.5" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - h} />
                      </svg>
                      {txt}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
      {/* The question, then the camera flies through it. */}
      <div style={{ position: "absolute", left: 120, right: 120, top: 380, transform: `scale(${mix(1, 7, E(thru))})`, opacity: 1 - ramp(t, 10.2, 10.9), filter: `blur(${thru * 20}px)` }}>
        <Words t={t} text="But does the live app" at={spread(5, tBut, tBut + 1.0)} size={112} color={GRAY} />
        <Words t={t} text="actually keep them?" at={spread(3, tBut + 1.05, tKeep + 0.1)} size={112} mark={["keep"]} />
      </div>
      <Sfx at={3.3} src={S.card} volume={0.35} />
      <Sfx at={tAdd} src={S.pop} volume={0.4} />
      <Sfx at={tSign} src={S.pop} volume={0.4} />
      <Sfx at={9.7} src={S.whoosh} volume={0.5} />
    </AbsoluteFill>
  );
}

// ================================================================== 2. Greenlight

function MarkPieces({ t, at, size }: { t: number; at: number; size: number }) {
  const parts: [React.ReactNode, number][] = [
    [<rect key="r" width="24" height="24" rx="5.6" fill={INK} />, 0],
    [<circle key="a" cx="4.1" cy="13.9" r="1.45" fill="#fff" />, 1],
    [<circle key="b" cx="7.9" cy="17.6" r="1.52" fill="#fff" />, 2],
    [<circle key="c" cx="11.6" cy="13.9" r="1.58" fill="#fff" />, 3],
    [<circle key="d" cx="15.4" cy="10.1" r="1.64" fill="#fff" />, 4],
    [<circle key="e" cx="19.1" cy="6.4" r="2" fill="#22b36b" />, 5],
  ];
  const pop = ramp(t, at + 0.9, at + 1.2) - ramp(t, at + 1.2, at + 1.6);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ overflow: "visible", transform: `scale(${1 + 0.1 * pop})` }}>
      {parts.map(([el, i]) => {
        const p = ramp(t, at + i * 0.07, at + i * 0.07 + 0.8);
        return (
          <g key={i} opacity={p} transform={`translate(${(1 - E(p)) * 14} 0)`} style={{ filter: `blur(${(1 - p) * 0.6}px)` }}>
            {el}
          </g>
        );
      })}
    </svg>
  );
}

export function Brand() {
  const t = useT();
  const tThis = say("brand", "This is Greenlight");
  const tChecks = say("brand", "It checks every promise");
  const tKane = say("brand", "using Kane CLI");
  const tClaude = say("brand", "and Claude Code");
  const slide = ramp(t, 1.3, 2.2, EIO);
  const lift = ramp(t, tChecks - 0.5, tChecks + 0.3, EIO);
  const cardsOut = 11.7;
  const letters = "Greenlight".split("");
  const cards = [
    { at: tChecks, n: "01", title: "Checks every promise", sub: "on your live app", icon: "check" },
    { at: tKane, n: "02", title: "Kane CLI tests it", sub: "in a real browser", icon: "browser" },
    { at: tClaude, n: "03", title: "Claude Code fixes it", sub: "and asks Kane again", icon: "term" },
  ];
  return (
    <AbsoluteFill>
      <Stage />
      <div style={{ position: "absolute", left: 0, top: mix(420, 150, lift), width: 1920, height: 220, transform: `scale(${mix(1, 0.6, lift)})`, opacity: 1 - ramp(t, cardsOut, cardsOut + 0.6), filter: `blur(${ramp(t, cardsOut, cardsOut + 0.6) * 12}px)` }}>
        <div style={{ position: "absolute", left: mix(860, 560, slide), top: 10 }}>
          <MarkPieces t={t} at={0.15} size={200} />
        </div>
        <div style={{ position: "absolute", left: 820, top: 30, display: "flex", font: `700 150px/1 ${SANS}`, letterSpacing: "-0.05em", color: INK }}>
          {letters.map((c, i) => {
            const p = ramp(t, 1.55 + i * 0.035, 1.55 + i * 0.035 + 0.5);
            return <span key={i} style={{ display: "inline-block", opacity: p, filter: `blur(${(1 - p) * 14}px)`, transform: `translateY(${(1 - p) * 18}px)` }}>{c}</span>;
          })}
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 690, opacity: 1 - lift }}>
        <Words t={t} text="Does your app do what its README says?" at={2.4} stagger={0.06} size={44} weight={500} color={GRAY} />
      </div>
      {cards.map((c, i) => (
        <Card key={i} t={t} at={c.at - 0.15} out={cardsOut + i * 0.06} x={180 + i * 540} y={420} w={480} h={360}>
          <div style={{ font: `500 20px ${MONO}`, color: GRAY }}>{c.n}</div>
          <div style={{ marginTop: 34 }}><Icon kind={c.icon} p={ramp(t, c.at + 0.2, c.at + 0.9)} /></div>
          <div style={{ font: `700 38px ${SANS}`, letterSpacing: "-0.035em", color: INK, marginTop: 30 }}>{c.title}</div>
          <div style={{ font: `400 24px ${SANS}`, color: GRAY, marginTop: 8 }}>{c.sub}</div>
        </Card>
      ))}
      <Sfx at={0.15} src={S.swish} volume={0.4} />
      <Sfx at={1.5} src={S.pop} volume={0.3} />
      {cards.map((c, i) => <Sfx key={i} at={c.at - 0.1} src={S.card} volume={0.35} />)}
      <Sfx at={cardsOut} src={S.whoosh} volume={0.45} />
    </AbsoluteFill>
  );
}

function Icon({ kind, p }: { kind: string; p: number }) {
  const d = 1 - p;
  const st = { fill: "none", stroke: INK, strokeWidth: 2.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, pathLength: 1, strokeDasharray: "1 1", strokeDashoffset: d };
  return (
    <svg width="64" height="64" viewBox="0 0 64 64">
      {kind === "check" ? (
        <>
          <circle cx="32" cy="32" r="26" {...st} />
          <path d="M21 33l7.5 7.5L44 25" {...st} />
        </>
      ) : kind === "browser" ? (
        <>
          <rect x="6" y="12" width="52" height="40" rx="7" {...st} />
          <path d="M6 22h52" {...st} />
          <path d="M26 40l6-8 6 8" {...st} />
        </>
      ) : (
        <>
          <rect x="6" y="12" width="52" height="40" rx="7" {...st} />
          <path d="M17 26l7 6-7 6M29 39h16" {...st} />
        </>
      )}
    </svg>
  );
}

// ================================================================== 3. Start a check

const REPO = "https://github.com/XDGram/GREENLIGHT";
const URL = "https://greenlight-demo-shop.vercel.app";
const REPO_STEPS = [4, 8, 12, 16, 20, 24, 28, 32, 36];
const URL_STEPS = [4, 8, 12, 16, 20, 24, 28, 32, 36, 39];
const SC = 640; // claims step scroll

export const START_END = (): { cam: Cam } => ({ cam: frame(pageBox({ x: 238, y: 765, w: 964, h: 470 }, SC), 70, 1.6) });

export function Start() {
  const t = useT();
  const tRepo = say("start", "your code on GitHub");
  const tUrl = say("start", "the link to your live app");
  const tRm = say("start", "and your README");
  const tAll = say("start", "That's all");
  const tNo = say("start", "No account");
  const tClick = say("start", "no setup", true) + 0.15;
  const cps = 34;
  const repoAt = tRepo + 0.2;
  const urlAt = tUrl + 0.15;
  const nRepo = clamp01((t - repoAt) * cps / REPO.length) * REPO.length;
  const nUrl = clamp01((t - urlAt) * cps / URL.length) * URL.length;
  const drop = tRm + 0.75;
  const scroll = mix(0, SC, ramp(t, tClick + 0.4, tClick + 1.5, EIO));
  let img = "cap/app/new-empty.jpg";
  if (nRepo >= 4) img = stepImage("cap/app/new-repo-", REPO_STEPS, Math.floor(nRepo), img);
  if (nUrl >= 4) img = stepImage("cap/app/new-url-", URL_STEPS, Math.floor(nUrl), img);
  if (t >= drop) img = "cap/app/new-loaded.jpg";
  if (t >= tClick + 0.35) img = "cap/app/claims.jpg";
  const E0 = APP["new-empty"];
  const repo = pageBox(E0.repo), url = pageBox(E0.url), notes = pageBox(E0.notes), check = pageBox(A("new-loaded", "check"));
  const enter = ramp(t, 0, 1.1);
  const keysCam: [number, Cam][] = [
    [0, { x: 960, y: 560, k: 0.94 }],
    [tRepo - 0.55, OVER],
    [tRepo, frame(repo, 150, 2.3)],
    [tUrl - 0.25, frame(repo, 150, 2.3)],
    [tUrl + 0.1, frame(url, 150, 2.3)],
    [tRm - 0.25, frame(url, 150, 2.3)],
    [tRm + 0.3, frame(notes, 70, 1.7)],
    [tAll - 0.1, frame(notes, 70, 1.7)],
    [tAll + 0.45, frame(check, 220, 2.6)],
    [tClick + 0.25, frame(check, 220, 2.6)],
    [tClick + 1.5, START_END().cam],
  ];
  const cam = camAt(t, keysCam);
  const [rx, ry] = center(repo), [ux, uy] = center(url), [cx, cy] = center(check), [nx, ny] = center(notes);
  const ptr = along(t, [
    [tRepo - 1.0, 1500, 980],
    [tRepo - 0.15, rx - 120, ry + 6],
    [tUrl - 0.4, rx - 100, ry + 8],
    [tUrl - 0.1, ux - 120, uy + 6],
    [tRm + 0.2, ux, uy + 120],
    [tAll + 0.1, cx + 90, cy + 70],
    [tClick - 0.05, cx, cy],
    [tClick + 2, cx + 4, cy + 4],
  ]);
  const down = Math.max(press(t, tRepo - 0.05), press(t, tUrl - 0.05), press(t, tClick));
  // README.md file flies in and drops on the box.
  const fp = ramp(t, tRm - 0.1, drop, EIO);
  const fx = mix(nx + 760, nx, fp), fy = mix(ny - 160, ny, fp);
  return (
    <AbsoluteFill>
      <Stage />
      <Camera t={t} keys={keysCam}>
        <div style={{ position: "absolute", inset: 0, perspective: 2200 }}>
          <div style={{ position: "absolute", inset: 0, transformOrigin: "50% 80%", transform: `rotateX(${(1 - E(enter)) * 24}deg) translateY(${(1 - E(enter)) * 160}px) scale(${mix(0.9, 1, E(enter))})`, opacity: enter, filter: `blur(${(1 - enter) * 12}px)` }}>
            <Window src={img} scroll={scroll} url={`${APP_URL}/app/new`} />
          </div>
        </div>
        <Tag x={repo.x + repo.w + 18} y={ry} t={t} at={tRepo + 0.1} out={tUrl - 0.3} text="Your code" k={cam.k} />
        <Tag x={url.x - 18} y={uy} t={t} at={tUrl + 0.25} out={tRm - 0.3} text="Your live app" k={cam.k} side="left" />
        <Tag x={notes.x + 20} y={notes.y + notes.h + 34} t={t} at={drop + 0.1} out={tAll} text="Your README" k={cam.k} />
        <Tag x={check.x + check.w + 18} y={cy} t={t} at={tNo - 0.05} out={tClick + 0.3} text="No account. No setup." k={cam.k} />
        {fp > 0 && t < drop + 0.12 ? (
          <div style={{ position: "absolute", left: fx - 60, top: fy - 74, width: 120, height: 148, borderRadius: 14, background: "#fff", boxShadow: "0 24px 50px rgba(15,18,25,0.22), 0 0 0 1px rgba(15,18,25,0.08)", transform: `rotate(${(1 - fp) * -10}deg) scale(${mix(1, 0.8, ramp(t, drop - 0.1, drop + 0.1))})`, opacity: 1 - ramp(t, drop, drop + 0.12), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: 16, zIndex: 58 }}>
            <div style={{ position: "absolute", top: 22, left: 20, right: 20, height: 5, borderRadius: 3, background: LINE, boxShadow: `0 14px 0 ${LINE}, 0 28px 0 ${LINE}, 0 42px 0 ${LINE}` }} />
            <span style={{ font: `600 15px ${SANS}`, color: INK }}>README.md</span>
          </div>
        ) : null}
        <Pointer x={ptr[0]} y={ptr[1]} down={down} k={cam.k} opacity={ramp(t, tRepo - 1.0, tRepo - 0.7)} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={tRepo - 0.05} k={cam.k} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={tUrl - 0.05} k={cam.k} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={tClick} k={cam.k} />
      </Camera>
      <Sfx at={0.05} src={S.open} volume={0.45} />
      <Sfx at={tRepo - 0.05} src={S.click} volume={0.6} />
      <Keys start={repoAt} n={REPO.length} cps={cps} />
      <Sfx at={tUrl - 0.05} src={S.click} volume={0.6} />
      <Keys start={urlAt} n={URL.length} cps={cps} />
      <Sfx at={tRm - 0.1} src={S.swish} volume={0.35} />
      <Sfx at={drop} src={S.drop} volume={0.6} />
      <Sfx at={tClick} src={S.click} volume={0.65} />
      <Sfx at={tClick + 0.4} src={S.swish} volume={0.3} />
    </AbsoluteFill>
  );
}

// ================================================================== 4. Claims

export function Claims() {
  const t = useT();
  const tTurn = say("claims", "into a claim");
  const tChoose = say("claims", "You choose");
  const off = tChoose + 0.55;
  const on = tChoose + 1.6;
  const tCost = say("claims", "see exactly what");
  const tRun = say("claims", "Nothing runs");
  const tClick = voEnd("claims") + 0.15;
  const C = APP.claims;
  const rows = pageBox({ x: C.row1.x, y: C.row1.y - 70, w: C.row1.w, h: C.row2.y + C.row2.h - C.row1.y + 70 }, SC);
  const sw = pageBox(C.switch2, SC), conf = pageBox(C.confirm, SC), run = pageBox(C.run, SC);
  const [sx, sy] = center(sw), [rx, ry] = center(run);
  const keysCam: [number, Cam][] = [
    [0, START_END().cam],
    [0.6, START_END().cam],
    [1.3, frame(rows, 90, 1.8)],
    [tChoose - 0.2, frame(rows, 90, 1.8)],
    [tChoose + 0.3, frame(sw, 260, 2.6)],
    [on + 0.35, frame(sw, 260, 2.6)],
    [tCost + 0.2, frame(conf, 70, 1.8)],
    [tRun, frame(conf, 70, 1.8)],
    [tRun + 0.5, frame(run, 260, 2.6)],
    [tClick + 0.05, frame(run, 260, 2.6)],
    [tClick + 0.75, { x: rx, y: ry, k: 16 }],
  ];
  const cam = camAt(t, keysCam);
  const img = t >= off && t < on ? "cap/app/claims-off.jpg" : "cap/app/claims.jpg";
  const ptr = along(t, [
    [0.4, 1300, 1100],
    [tChoose + 0.25, sx + 40, sy + 30],
    [off - 0.05, sx + 14, sy],
    [on + 0.3, sx + 16, sy + 2],
    [tRun + 0.6, rx + 30, ry + 26],
    [tClick - 0.05, rx, ry],
    [tClick + 2, rx, ry],
  ]);
  const down = Math.max(press(t, off), press(t, on), press(t, tClick));
  return (
    <AbsoluteFill>
      <Stage />
      <Camera t={t} keys={keysCam}>
        <Window src={img} scroll={SC} url={`${APP_URL}/app/new`} />
        <Tag x={rows.x + rows.w + 18} y={rows.y + 40} t={t} at={tTurn} out={tChoose - 0.1} text="Each promise, a claim" k={cam.k} />
        <Tag x={sw.x + sw.w + 300} y={sy} t={t} at={tChoose + 0.35} out={on + 0.3} text="You choose" k={cam.k} />
        <Tag x={conf.x + conf.w - 10} y={conf.y - 24} t={t} at={tCost + 0.3} out={tRun} text="Exact cost first" k={cam.k} side="left" />
        <Tag x={run.x + run.w + 18} y={ry} t={t} at={tRun + 0.5} out={tClick} text="Run is your approval" k={cam.k} />
        <Pointer x={ptr[0]} y={ptr[1]} down={down} k={cam.k} opacity={ramp(t, tChoose - 0.4, tChoose) * (1 - ramp(t, tClick + 0.2, tClick + 0.4))} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={off} k={cam.k} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={on} k={cam.k} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={tClick} k={cam.k} />
      </Camera>
      {white(ramp(t, tClick + 0.4, tClick + 0.8))}
      <Sfx at={off} src={S.toggle} volume={0.6} />
      <Sfx at={on} src={S.toggle} volume={0.6} />
      <Sfx at={tCost + 0.1} src={S.swish} volume={0.25} />
      <Sfx at={tClick} src={S.click} volume={0.7} />
      <Sfx at={tClick + 0.05} src={S.riser} volume={0.4} />
    </AbsoluteFill>
  );
}

// ================================================================== 5. Kane CLI tests it

/** The real live board, animated from its 30 fps capture, with a running timer drawn over the frozen one. */
function LiveBoard({ t, timer }: { t: number; timer: number }) {
  const b = pageBox(APP.running.board);
  const i = ((Math.floor(t * 30) % 90) + 90) % 90;
  const s = Math.max(0, Math.floor(timer));
  return (
    <div style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 12, overflow: "hidden" }}>
      <Img src={staticFile(`cap/app/board/b${String(i).padStart(2, "0")}.jpg`)} style={{ width: b.w, height: b.h, display: "block" }} />
      <div style={{ position: "absolute", right: 6, top: 4, width: 64, height: 24, background: "#141a23" }} />
      <div style={{ position: "absolute", right: 12, top: 7, font: `700 13px ${MONO}`, color: "#e6edf5" }}>
        {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
      </div>
    </div>
  );
}

const SHOP_WIN = WIN;
const sp = (x: number, y: number) => pageToStage(x, y, 0, SHOP_WIN);
const shopBox = (b: { x: number; y: number; w: number; h: number }) => pageBox(b, 0, SHOP_WIN);
const RESULT = { x: 560, y: 830, w: 320, h: 26 };

function shopImage(t: number, o: { hoverAt?: number; clickAt?: number; typeAt?: number; cps?: number; fail1?: number; retry?: number; fail2?: number; okAt?: number; base?: string }) {
  let img = o.base ?? "cap/shop/shop.jpg";
  if (o.hoverAt != null && t >= o.hoverAt) img = `cap/shop/shop-hover-${String(Math.min(12, Math.floor((t - o.hoverAt) * 12))).padStart(2, "0")}.jpg`;
  if (o.clickAt != null && t >= o.clickAt) img = t < o.clickAt + 0.3 ? "cap/shop/shop-count1-bump.jpg" : "cap/shop/shop-count1.jpg";
  if (o.clickAt != null && t >= o.clickAt + 1.2) img = "cap/shop/shop-count1-rest.jpg";
  if (o.typeAt != null && t >= o.typeAt) img = stepImage("cap/shop/shop-email-", [3, 6, 9, 12, 15], Math.floor((t - o.typeAt) * (o.cps ?? 12)), img);
  if (o.fail1 != null && t >= o.fail1) img = "cap/shop/shop-failed.jpg";
  if (o.retry != null && t >= o.retry) img = "cap/shop/shop-email-15.jpg";
  if (o.fail2 != null && t >= o.fail2) img = "cap/shop/shop-failed.jpg";
  if (o.okAt != null && t >= o.okAt) img = "cap/shop/shop-ok.jpg";
  return img;
}

export function Kane() {
  const t = useT();
  const tKane = say("kane", "This is where Kane CLI");
  const tHands = say("kane", "Greenlight hands it");
  const tOpens = say("kane", "Kane opens");
  const tWay = say("kane", "the way a person would");
  const tClicks = say("kane", "it clicks");
  const tTypes = say("kane", "it types");
  const tReads = say("kane", "it reads");
  const tWorks = say("kane", "The cart works");
  const tSub1 = say("kane", "But the newsletter") + 0.1;
  const tSub2 = say("kane", "saying no") + 0.3;
  const fail1 = tSub1 + 0.35, fail2 = tSub2 + 0.35;
  const board = pageBox(APP.running.board), lclaims = pageBox({ x: 235, y: 800, w: 553, h: 95 });
  const swap = ramp(t, tOpens - 0.3, tOpens + 0.6, EIO);
  const add = shopBox(SHOP.add), badge = shopBox(SHOP.cartlink), news = shopBox(SHOP.news), email = shopBox(SHOP.email), sub = shopBox(SHOP.subscribe), prod = shopBox(SHOP.product1), res = shopBox(RESULT);
  const [ax, ay] = center(add), [ex, ey] = center(email), [bx, by] = center(badge), [ux, uy] = center(sub);
  // The voice says "it clicks, it types" in under a second, so the actions start on "the way a person would".
  const clickAt = tWay - 0.5;
  const hoverAt = clickAt - 0.9;
  const emailAt = tClicks + 0.25;
  const typeAt = emailAt + 0.15;
  const keysCam: [number, Cam][] = [
    [0, frame(board, 10, 3.2)],
    [0.9, frame(board, 10, 3.0)],
    [tKane + 1.8, frame(board, 160, 1.8)],
    [tHands, frame(board, 160, 1.8)],
    [tHands + 0.6, frame(lclaims, 120, 2.3)],
    [tOpens - 0.3, frame(lclaims, 120, 2.3)],
    [tOpens + 0.6, { x: 960, y: 540, k: 1.0 }],
    [hoverAt - 0.6, { x: 960, y: 540, k: 1.0 }],
    [hoverAt, frame(prod, 70, 1.9)],
    [clickAt + 0.15, frame(prod, 70, 1.9)],
    [clickAt + 0.5, frame(badge, 230, 3.0)],
    [emailAt - 0.4, frame(badge, 230, 3.0)],
    [emailAt + 0.05, frame(news, 70, 2.0)],
    [tReads + 0.1, frame(news, 70, 2.0)],
    [tReads + 0.7, { x: 960, y: 540, k: 1.04 }],
    [tWorks - 0.25, { x: 960, y: 540, k: 1.04 }],
    [tWorks + 0.25, frame(badge, 230, 3.0)],
    [tSub1 - 0.45, frame(badge, 230, 3.0)],
    [tSub1 - 0.05, frame(news, 60, 2.1)],
    [tSub2 + 1.2, frame(news, 60, 2.1)],
    [21.6, frame(res, 120, 3.4)],
    [25.6, { ...frame(res, 120, 3.4), k: 9 }],
  ];
  const cam = camAt(t, keysCam);
  const ptr = along(t, [
    [tOpens + 0.6, 1650, 980],
    [hoverAt - 0.5, 900, 330],
    [hoverAt, ax - 30, ay + 4],
    [clickAt - 0.05, ax - 26, ay + 6],
    [emailAt - 0.05, ex - 60, ey + 4],
    [tReads + 0.5, 1240, 420],
    [tWorks - 0.2, bx + 40, by + 34],
    [tSub1 - 0.1, ux, uy],
    [tSub2 + 1, ux + 2, uy + 2],
  ]);
  const down = Math.max(press(t, clickAt), press(t, emailAt), press(t, tSub1), press(t, tSub2));
  const img = shopImage(t, { hoverAt, clickAt, typeAt, cps: 13, fail1, retry: tSub2, fail2 });
  const scan = ramp(t, tReads + 0.55, tWorks - 0.35, (x) => x);
  const shake = Math.max(ramp(t, fail1, fail1 + 0.05) * (1 - ramp(t, fail1 + 0.05, fail1 + 0.35)), ramp(t, fail2, fail2 + 0.05) * (1 - ramp(t, fail2 + 0.05, fail2 + 0.35)));
  const tray = 1 - swap;
  return (
    <AbsoluteFill>
      <Stage />
      <Camera t={t} keys={keysCam} shake={shake * 0.8}>
        {/* The run page, live. It steps back as the shop opens in front. */}
        <div style={{ position: "absolute", inset: 0, transform: `translateX(${-swap * 260}px) scale(${mix(1, 0.86, swap)})`, opacity: tray, filter: `blur(${swap * 8}px)` }}>
          <Window src="cap/app/running-00.jpg" url={`${APP_URL}/app/check`}>
            <div />
          </Window>
          <LiveBoard t={t} timer={t + 92} />
        </div>
        <div style={{ position: "absolute", inset: 0, perspective: 2400 }}>
          <div style={{ position: "absolute", inset: 0, transform: `translateX(${(1 - E(swap)) * 1500}px) rotateY(${(1 - E(swap)) * -24}deg)`, opacity: swap > 0 ? 1 : 0, filter: `blur(${(1 - swap) * 10}px)` }}>
            <Window src={img} url={SHOP_URL} win={SHOP_WIN} />
            {scan > 0 && scan < 1 ? (
              <div style={{ position: "absolute", left: SHOP_WIN.x, top: SHOP_WIN.y + SHOP_WIN.chrome + scan * SHOP_WIN.h - 120, width: SHOP_WIN.w, height: 120, background: "linear-gradient(180deg, rgba(11,12,14,0) 0%, rgba(11,12,14,0.06) 92%, rgba(11,12,14,0.5) 100%)", borderBottom: `2px solid ${INK}` }} />
            ) : null}
          </div>
        </div>
        <Tag x={board.x - 18} y={board.y + 40} t={t} at={tKane + 0.4} out={tHands} text="Kane CLI" k={cam.k} side="left" />
        <Tag x={lclaims.x + lclaims.w + 18} y={lclaims.y + 40} t={t} at={tHands + 0.6} out={tOpens - 0.3} text="Plain-English tests" k={cam.k} />
        <Tag x={add.x + add.w + 18} y={ay} t={t} at={clickAt} out={emailAt - 0.3} text="Clicks" k={cam.k} />
        <Tag x={email.x - 18} y={ey} t={t} at={typeAt} out={tReads} text="Types" k={cam.k} side="left" />
        <Tag x={1330} y={300} t={t} at={tReads + 0.55} out={tWorks - 0.3} text="Reads the screen" k={cam.k} />
        <Tag x={badge.x - 18} y={by} t={t} at={tWorks + 0.15} out={tSub1 - 0.4} text="Cart works" k={cam.k} side="left" />
        <Tag x={sub.x + sub.w + 18} y={uy} t={t} at={fail1 + 0.2} out={21.6} text="Newsletter fails" k={cam.k} />
        <Pointer x={ptr[0]} y={ptr[1]} down={down} label="Kane CLI" k={cam.k} opacity={ramp(t, tOpens + 0.5, tOpens + 0.9) * (1 - ramp(t, 21.4, 21.8))} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={clickAt} k={cam.k} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={emailAt} k={cam.k} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={tSub1} k={cam.k} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={tSub2} k={cam.k} />
      </Camera>
      {white(1 - ramp(t, 0, 0.55) + ramp(t, 24.9, 25.9))}
      <Sfx at={tOpens - 0.3} src={S.whoosh} volume={0.5} />
      <Sfx at={tOpens + 0.2} src={S.open} volume={0.4} />
      <Sfx at={clickAt} src={S.click} volume={0.65} />
      <Sfx at={clickAt + 0.12} src={S.pop} volume={0.45} />
      <Sfx at={emailAt} src={S.click} volume={0.6} />
      <Keys start={typeAt} n={15} cps={13} />
      <Sfx at={tReads + 0.5} src={S.swish} volume={0.25} />
      <Sfx at={tSub1} src={S.click} volume={0.65} />
      <Sfx at={fail1} src={S.error} volume={0.55} />
      <Sfx at={tSub2} src={S.click} volume={0.65} />
      <Sfx at={fail2} src={S.error} volume={0.5} />
      <Sfx at={24.4} src={S.riser} volume={0.35} />
    </AbsoluteFill>
  );
}

// ================================================================== 6. The verdict

const VS = 240; // verdict scroll that shows the claims and Kane's note

export function Verdict() {
  const t = useT();
  const tVer = say("verdict", "And here is the verdict");
  const tCart = say("verdict", "The cart passed");
  const tFail = say("verdict", "The newsletter failed");
  const tSaw = say("verdict", "exactly what it saw");
  const tStop = say("verdict", "doesn't stop");
  const tFix = say("verdict", "It brings up the fix");
  const F = APP.failed;
  const scroll = (() => {
    const k: [number, number][] = [[0, VS], [tVer + 0.2, VS], [tVer + 1.0, 0], [tCart - 0.6, 0], [tCart - 0.05, VS], [tFix - 0.4, VS], [tFix + 0.4, 0]];
    for (let i = 1; i < k.length; i++) if (t <= k[i][0]) return mix(k[i - 1][1], k[i][1], EIO(clamp01((t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]))));
    return 0;
  })();
  const fixArea = { x: F.note.x - 10, y: F.note.y - 10, w: 520, h: 300 };
  const keysCam: [number, Cam][] = [
    [0, frame(pageBox(F.note, VS), 30, 3.2)],
    [tVer + 0.1, frame(pageBox(F.note, VS), 30, 3.0)],
    [tVer + 1.1, frame(pageBox(F.verdict, 0), 90, 1.75)],
    [tCart - 0.6, frame(pageBox(F.verdict, 0), 90, 1.75)],
    [tCart - 0.05, frame(pageBox(F.claimPass, VS), 200, 2.5)],
    [tFail - 0.3, frame(pageBox(F.claimPass, VS), 200, 2.5)],
    [tFail + 0.1, frame(pageBox(F.claimFail, VS), 200, 2.5)],
    [tSaw - 0.3, frame(pageBox(F.claimFail, VS), 200, 2.5)],
    [tSaw + 0.15, frame(pageBox(fixArea, VS), 40, 2.4)],
    [tFix - 0.4, frame(pageBox(fixArea, VS), 40, 2.4)],
    [tFix + 0.5, frame(pageBox(F.fixcard, 0), 70, 1.9)],
    [tFix + 2.2, frame(pageBox(F.connect, 0), 230, 2.6)],
    [19, frame(pageBox(F.connect, 0), 230, 2.6)],
  ];
  const cam = camAt(t, keysCam);
  const conn = pageBox(F.connect, scroll);
  const ring = ramp(t, tFix + 1.4, tFix + 1.9);
  return (
    <AbsoluteFill>
      <Stage />
      <Camera t={t} keys={keysCam}>
        <Window src="cap/app/failed.jpg" scroll={scroll} url={`${APP_URL}/app/check`} />
        <Tag x={pageBox(F.claimPass, scroll).x + F.claimPass.w + 120} y={pageBox(F.claimPass, scroll).y + 22} t={t} at={tCart + 0.1} out={tFail - 0.3} text="Passed" k={cam.k} />
        <Tag x={pageBox(F.claimFail, scroll).x + F.claimFail.w + 120} y={pageBox(F.claimFail, scroll).y + 22} t={t} at={tFail + 0.2} out={tSaw - 0.3} text="Failed" k={cam.k} />
        <Tag x={pageBox(F.note, scroll).x + 500} y={pageBox(F.note, scroll).y - 20} t={t} at={tSaw + 0.25} out={tFix - 0.4} text="What Kane saw" k={cam.k} />
        {ring > 0 ? <div style={{ position: "absolute", left: conn.x - 8, top: conn.y - 8, width: conn.w + 16, height: conn.h + 16, borderRadius: 40, border: `3px solid ${INK}`, opacity: ring * (0.5 + 0.5 * Math.sin(t * 5)) }} /> : null}
      </Camera>
      {white(1 - ramp(t, 0, 0.5))}
      <Sfx at={tVer + 0.2} src={S.swish} volume={0.3} />
      <Sfx at={tCart} src={S.pop} volume={0.45} />
      <Sfx at={tFail} src={S.error} volume={0.35} />
      <Sfx at={tFix + 0.2} src={S.swish} volume={0.3} />
    </AbsoluteFill>
  );
}

// ================================================================== 7. Install, 8. Paste, 9. Fix: the Claude Code terminal

const ORANGE = "#d97757";
type Rect = { x: number; y: number; w: number; h: number };
const T_HALF: Rect = { x: 1000, y: 120, w: 840, h: 840 };
const T_FULL: Rect = { x: 210, y: 70, w: 1500, h: 940 };
const mixRect = (a: Rect, b: Rect, p: number): Rect => ({ x: mix(a.x, b.x, p), y: mix(a.y, b.y, p), w: mix(a.w, b.w, p), h: mix(a.h, b.h, p) });

function Terminal({ r, size = 22, children, opacity = 1, blur = 0 }: { r: Rect; size?: number; children: React.ReactNode; opacity?: number; blur?: number }) {
  return (
    <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 18, overflow: "hidden", background: "#16171a", boxShadow: "0 50px 120px rgba(15,18,25,0.25), 0 14px 34px rgba(15,18,25,0.15)", opacity, filter: blur ? `blur(${blur}px)` : undefined }}>
      <div style={{ height: 48, background: "#1f2024", display: "flex", alignItems: "center", padding: "0 18px", gap: 8, borderBottom: "1px solid #2a2c31" }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: 12, background: c }} />)}
        <span style={{ flex: 1, textAlign: "center", font: `500 16px ${MONO}`, color: "#8b8f98", marginRight: 52 }}>demo-shop — claude</span>
      </div>
      <div style={{ padding: `${size * 1.2}px ${size * 1.5}px`, font: `400 ${size}px/1.6 ${MONO}`, color: "#e8e9ec" }}>{children}</div>
    </div>
  );
}
function Welcome() {
  return (
    <div style={{ border: `1.5px solid ${ORANGE}`, borderRadius: 10, padding: "0.7em 1em", width: "fit-content", minWidth: "26em" }}>
      <div><span style={{ color: ORANGE }}>✻</span> Welcome to <b>Claude Code</b>!</div>
      <div style={{ color: "#8b8f98", marginTop: "0.6em", fontSize: "0.86em" }}>/help for help, /status for your current setup</div>
      <div style={{ color: "#8b8f98", marginTop: "0.2em", fontSize: "0.86em" }}>cwd: ~/demo-shop</div>
    </div>
  );
}
function Prompt({ text, caret = true }: { text?: React.ReactNode; caret?: boolean }) {
  return (
    <div style={{ marginTop: "1em", border: "1.5px solid #4a4d55", borderRadius: 10, padding: "0.5em 0.8em", display: "flex", gap: "0.6em" }}>
      <span style={{ color: "#8b8f98" }}>&gt;</span>
      <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>
        {text ?? <span style={{ color: "#5f636b" }}>Try "fix the failing claim"</span>}
        {caret ? <span style={{ display: "inline-block", width: "0.55em", height: "1.15em", background: "#e8e9ec", verticalAlign: "-0.2em", marginLeft: 2 }} /> : null}
      </span>
    </div>
  );
}
const PASTED = (
  <>
    Use Greenlight to fix my app until Kane CLI passes every claim. <span style={{ color: "#8b8f98" }}>[Pasted text +6 lines]</span>
  </>
);
function Msg({ p, children, sub }: { p: number; children: React.ReactNode; sub?: React.ReactNode }) {
  if (p <= 0) return null;
  const e = E(clamp01(p * 1.6));
  return (
    <div style={{ marginTop: "0.8em", opacity: e, transform: `translateY(${(1 - e) * 14}px)`, filter: `blur(${(1 - e) * 6}px)` }}>
      <div style={{ display: "flex", gap: "0.6em" }}>
        <span style={{ color: "#e8e9ec" }}>⏺</span>
        <span>{children}</span>
      </div>
      {sub ? (
        <div style={{ display: "flex", gap: "0.6em", marginLeft: "0.4em", marginTop: "0.2em", color: "#a7abb3" }}>
          <span style={{ color: "#5f636b" }}>⎿</span>
          <div>{sub}</div>
        </div>
      ) : null}
    </div>
  );
}
const spinner = (t: number, label: string) => (
  <div style={{ marginTop: "0.8em", color: ORANGE }}>
    {"✢✳✶✻✽"[Math.floor(t * 8) % 5]} <span style={{ color: "#e8e9ec" }}>{label}</span>
  </div>
);

/** Camera that shows the Fix card on the left half while the terminal takes the right. */
const SPLIT = (scroll = 0): Cam => {
  const f = pageBox(APP.failed.fixcard, scroll);
  const k = 1.25;
  return { x: f.x + f.w / 2 + (960 - 470) / k, y: f.y + f.h / 2 + 60, k };
};

export function Install() {
  const t = useT();
  const tFirst = say("install", "First time");
  const tCopy = say("install", "Copy one line");
  const tReady = say("install", "Claude Code is ready");
  const tOnce = say("install", "You only do this once");
  const F = APP.failed, FI = APP["failed-install"];
  const clickInst = tFirst + 0.55;
  const IS = 420;
  const scroll = mix(0, IS, ramp(t, clickInst + 0.3, clickInst + 1.1, EIO)) * (1 - ramp(t, 10.4, 11.4, EIO));
  const copyAt = tCopy + 0.25;
  const img = t < clickInst + 0.08 ? "cap/app/failed.jpg" : t < copyAt + 0.05 ? "cap/app/failed-install.jpg" : "cap/app/failed-install-copied.jpg";
  const inst = pageBox(F.install, 0), copyB = pageBox(FI.copy, IS), code = pageBox(FI.code, IS);
  const keysCam: [number, Cam][] = [
    [0, frame(pageBox(F.connect, 0), 230, 2.6)],
    [0.3, frame(pageBox(F.connect, 0), 230, 2.6)],
    [clickInst - 0.3, frame(inst, 200, 2.6)],
    [clickInst + 0.3, frame(inst, 200, 2.6)],
    [clickInst + 1.2, frame({ x: code.x, y: copyB.y, w: code.w, h: code.y + code.h - copyB.y }, 90, 2.2)],
    [tReady - 0.5, frame({ x: code.x, y: copyB.y, w: code.w, h: code.y + code.h - copyB.y }, 90, 2.2)],
    [tReady + 0.4, { ...SPLIT(IS), y: code.y }],
    [10.4, { ...SPLIT(IS), y: code.y }],
    [11.6, SPLIT(0)],
  ];
  const cam = camAt(t, keysCam);
  const [ix, iy] = center(inst), [cx, cy] = center(copyB);
  const ptr = along(t, [
    [0.2, ix + 260, iy + 140],
    [clickInst - 0.05, ix - 60, iy],
    [clickInst + 1.1, ix - 30, iy + 200],
    [copyAt - 0.05, cx, cy],
    [copyAt + 2, cx + 2, cy + 2],
  ]);
  const down = Math.max(press(t, clickInst), press(t, copyAt));
  const rise = ramp(t, tReady - 0.5, tReady + 0.5);
  return (
    <AbsoluteFill>
      <Stage />
      <Camera t={t} keys={keysCam}>
        <Window src={img} scroll={scroll} url={`${APP_URL}/app/check`} />
        <Tag x={copyB.x - 18} y={cy} t={t} at={copyAt + 0.15} out={tReady} text="One line" k={cam.k} side="left" />
        <Pointer x={ptr[0]} y={ptr[1]} down={down} k={cam.k} opacity={1 - ramp(t, copyAt + 0.5, copyAt + 0.8)} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={clickInst} k={cam.k} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={copyAt} k={cam.k} />
      </Camera>
      <div style={{ position: "absolute", inset: 0, perspective: 2000 }}>
        <div style={{ position: "absolute", inset: 0, transformOrigin: "75% 100%", transform: `translateY(${(1 - E(rise)) * 700}px) rotateX(${(1 - E(rise)) * 30}deg)`, opacity: rise }}>
          <Terminal r={T_HALF} size={21} blur={(1 - rise) * 10}>
            <Welcome />
            <Prompt />
          </Terminal>
        </div>
      </div>
      <div style={{ position: "absolute", left: T_HALF.x, width: T_HALF.w, top: T_HALF.y + T_HALF.h + 30 - 1000, opacity: 0 }} />
      <div style={{ position: "absolute", left: T_HALF.x, top: 40, width: T_HALF.w }}>
        <Words t={t} text="Set up once. About five minutes." at={tOnce - 0.1} stagger={0.07} size={34} weight={600} color={GRAY} out={12.2} />
      </div>
      <Sfx at={clickInst} src={S.click} volume={0.6} />
      <Sfx at={copyAt} src={S.click} volume={0.6} />
      <Sfx at={copyAt + 0.1} src={S.copy} volume={0.45} />
      <Sfx at={tReady - 0.5} src={S.whoosh} volume={0.4} />
      <Sfx at={tReady} src={S.open} volume={0.35} />
    </AbsoluteFill>
  );
}

export function Paste() {
  const t = useT();
  const tClick = say("paste", "click Connect") + 0.4;
  const tCopy = say("paste", "copy one message") + 0.3;
  const tPaste = say("paste", "paste it into") + 0.45;
  const tFind = say("paste", "find your check");
  const tEnter = voEnd("paste") + 0.2;
  const F = APP.failed, FC = APP["failed-connect"];
  const img = t < tClick + 0.08 ? "cap/app/failed-install-copied.jpg" : t < tCopy + 0.05 ? "cap/app/failed-connect.jpg" : "cap/app/failed-connect-copied.jpg";
  const conn = pageBox(F.connect, 0), copyB = pageBox(FC.copy, 0), msg = pageBox(FC.message, 0);
  const keysCam: [number, Cam][] = [
    [0, SPLIT(0)],
    [tClick + 0.2, SPLIT(0)],
    [tClick + 0.9, { ...SPLIT(0), y: msg.y + 120, k: 1.35 }],
    [11.5, { ...SPLIT(0), y: msg.y + 120, k: 1.35 }],
    [12.6, { ...SPLIT(0), x: SPLIT(0).x + 1500, y: msg.y + 120, k: 1.35 }],
  ];
  const cam = camAt(t, keysCam);
  const [nx, ny] = center(conn), [cx, cy] = center(copyB);
  const ptr = along(t, [
    [0.1, nx + 200, ny + 220],
    [tClick - 0.05, nx, ny],
    [tCopy - 0.05, cx, cy],
    [tCopy + 2, cx + 2, cy + 2],
  ]);
  const down = Math.max(press(t, tClick), press(t, tCopy));
  // Copy button on screen, for the flying chip.
  const toScreen = (x: number, y: number) => [960 + (x - cam.x) * cam.k, 540 + (y - cam.y) * cam.k];
  const [sx, sy] = toScreen(cx, cy);
  const fly = ramp(t, tCopy + 0.25, tPaste, EIO);
  const tx = T_HALF.x + 160, ty = T_HALF.y + 300;
  const grow = ramp(t, 11.5, 12.8, EIO);
  const sent = ramp(t, tEnter, tEnter + 0.4);
  const link = ramp(t, tFind - 0.2, tFind + 0.6) * (1 - ramp(t, 11, 11.5));
  return (
    <AbsoluteFill>
      <Stage />
      <Camera t={t} keys={keysCam}>
        <Window src={img} url={`${APP_URL}/app/check`} />
        <Pointer x={ptr[0]} y={ptr[1]} down={down} k={cam.k} opacity={1 - ramp(t, tCopy + 0.4, tCopy + 0.7)} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={tClick} k={cam.k} />
        <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={tCopy} k={cam.k} />
      </Camera>
      {link > 0 ? (
        <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
          <path d={`M ${T_HALF.x - 10} ${T_HALF.y + 420} C ${T_HALF.x - 120} ${T_HALF.y + 420}, ${T_HALF.x - 120} 300, ${T_HALF.x - 260} 300`} fill="none" stroke={INK} strokeWidth="2.5" strokeDasharray="8 10" strokeDashoffset={-t * 40} opacity={link} pathLength={undefined} />
          <circle cx={T_HALF.x - 10} cy={T_HALF.y + 420} r="7" fill={INK} opacity={link} />
        </svg>
      ) : null}
      <Terminal r={mixRect(T_HALF, T_FULL, grow)} size={mix(21, 30, grow)}>
        {sent > 0 ? (
          <>
            <div style={{ background: "#25272c", borderRadius: 8, padding: "0.4em 0.7em", color: "#c9ccd2", opacity: sent }}>&gt; {PASTED}</div>
            {spinner(t, "Reading Kane's verdict…")}
          </>
        ) : (
          <>
            <Welcome />
            <Prompt text={t > tPaste ? PASTED : undefined} />
          </>
        )}
      </Terminal>
      {fly > 0 && fly < 1 ? (
        <div style={{ position: "absolute", left: mix(sx, tx, fly), top: mix(sy, ty, fly) - Math.sin(fly * Math.PI) * 120, transform: `translate(-50%,-50%) scale(${mix(1, 0.85, fly)})`, padding: "12px 20px", borderRadius: 12, background: INK, color: "#fff", font: `600 20px ${SANS}`, boxShadow: "0 18px 40px rgba(0,0,0,0.3)", opacity: Math.min(1, fly * 6, (1 - fly) * 6), filter: `blur(${Math.sin(fly * Math.PI) * 2}px)`, zIndex: 80 }}>
          Message copied
        </div>
      ) : null}
      <div style={{ position: "absolute", left: T_HALF.x, top: 40, width: T_HALF.w, opacity: 1 - grow }}>
        <Words t={t} text="One paste." at={tPaste + 0.1} size={40} weight={600} color={GRAY} />
      </div>
      <Sfx at={tClick} src={S.click} volume={0.65} />
      <Sfx at={tClick + 0.1} src={S.card} volume={0.3} />
      <Sfx at={tCopy} src={S.click} volume={0.6} />
      <Sfx at={tCopy + 0.1} src={S.copy} volume={0.45} />
      <Sfx at={tCopy + 0.3} src={S.swish} volume={0.35} />
      <Sfx at={tPaste} src={S.drop} volume={0.45} />
      <Sfx at={tEnter} src={S.click} volume={0.6} />
      <Sfx at={11.5} src={S.whoosh} volume={0.45} />
    </AbsoluteFill>
  );
}

export function Fix() {
  const t = useT();
  const a = say("fix", "Claude Code reads") - 0.2;
  const aRes = say("fix", "including what Kane saw") - 0.3;
  const b = say("fix", "It uses that") - 0.1;
  const c = say("fix", "the form was misreading") - 0.2;
  const d = say("fix", "It fixes it") - 0.1;
  const e = say("fix", "waits for the new version") - 0.1;
  const eDone = e + 2.4;
  const f = say("fix", "asks Kane to check again") - 0.1;
  const g = say("fix", "You just watch") + 0.2;
  const diffZoom = ramp(t, c + 1.0, c + 1.6, EIO) * (1 - ramp(t, d - 0.2, d + 0.5, EIO));
  const out = ramp(t, 24.8, 26.4, EIO);
  // A slow push that follows the newest line, a closer look at the diff, then it leaves.
  const push = mix(1, 1.06, ramp(t, 0, 24, (x) => x));
  const k = push * mix(1, 1.32, diffZoom) * mix(1, 0.7, out);
  const oy = mix(0, -150, ramp(t, d, f + 0.5, EIO)) + mix(0, -40, diffZoom);
  return (
    <AbsoluteFill>
      <Stage />
      <div style={{ position: "absolute", inset: 0, transformOrigin: "50% 45%", transform: `translateY(${oy}px) scale(${k})`, opacity: 1 - ramp(t, 25.6, 26.6), filter: `blur(${out * 16}px)` }}>
        <Terminal r={T_FULL} size={30}>
          <div style={{ background: "#25272c", borderRadius: 8, padding: "0.4em 0.7em", color: "#c9ccd2" }}>&gt; {PASTED}</div>
          {t < a ? spinner(t, "Reading Kane's verdict…") : null}
          <Msg p={ramp(t, a, a + 0.5)} sub={t > aRes ? <span style={{ opacity: ramp(t, aRes, aRes + 0.4) }}>Cart: passed. Newsletter: failed. Kane saw every sign-up say “Subscription failed.”</span> : null}>
            Reading Kane's verdict from Greenlight.
          </Msg>
          <Msg p={ramp(t, b, b + 0.5)}>Looking at the sign-up form.</Msg>
          <Msg p={ramp(t, c, c + 0.5)} sub={t > c + 0.9 ? (
            <div style={{ opacity: ramp(t, c + 0.9, c + 1.3), border: "1px solid #34373e", borderRadius: 8, overflow: "hidden", fontSize: "0.9em", marginTop: 4, width: "26em" }}>
              <div style={{ padding: "2px 12px", color: "#8b8f98", background: "#1e1f23" }}>app.js</div>
              <div style={{ padding: "2px 12px", background: "rgba(239,90,60,0.15)", color: "#f1a99a" }}>-   if (res.status === "ok") {"{"}</div>
              <div style={{ padding: "2px 12px", background: "rgba(255,255,255,0.08)", color: "#ffffff" }}>+   if (res.ok) {"{"}</div>
            </div>
          ) : null}>
            Found it: the form misreads the server's reply, so every sign-up looks like a failure.
          </Msg>
          <Msg p={ramp(t, d, d + 0.5)}>Fixed. Saving the change and publishing it.</Msg>
          <Msg p={ramp(t, e, e + 0.5)} sub={t > eDone ? <span style={{ opacity: ramp(t, eDone, eDone + 0.3) }}>The new version is live.</span> : null}>
            Waiting for the new version to go live{t > eDone ? "." : "…"}
          </Msg>
          <Msg p={ramp(t, f, f + 0.5)}>Asking Greenlight to have Kane check again.</Msg>
          {t > g ? spinner(t, "Kane is checking again…") : null}
        </Terminal>
      </div>
      <Sfx at={a} src={S.pop} volume={0.3} />
      <Sfx at={b} src={S.pop} volume={0.3} />
      <Sfx at={c} src={S.pop} volume={0.3} />
      <Sfx at={c + 1.0} src={S.swish} volume={0.3} />
      <Sfx at={d} src={S.pop} volume={0.3} />
      <Sfx at={eDone} src={S.copy} volume={0.35} />
      <Sfx at={f} src={S.pop} volume={0.3} />
      <Sfx at={24.8} src={S.whoosh} volume={0.45} />
    </AbsoluteFill>
  );
}

// ================================================================== 10. Kane checks again

export function Again() {
  const t = useT();
  const tTests = say("again", "Kane tests the new version");
  const tWorks = say("again", "This time it works");
  const tPass = say("again", "Every claim passes");
  const tFound = say("again", "Kane found the problem");
  const tFixed = say("again", "Claude Code fixed it");
  const tProved = say("again", "Kane proved the fix");
  const shopIn = ramp(t, tTests - 0.6, tTests + 0.3, EIO);
  const typeAt = tTests + 0.6;
  const subAt = tWorks - 0.45;
  const okAt = subAt + 0.35;
  const passIn = ramp(t, tPass - 0.5, tPass + 0.2, EIO);
  const cardsAt = tFound - 0.4;
  const pullOut = ramp(t, cardsAt - 0.4, cardsAt + 0.3, EIO);
  const email = shopBox(SHOP.email), sub = shopBox(SHOP.subscribe), news = shopBox(SHOP.news), res = shopBox(RESULT);
  const [ex, ey] = center(email), [ux, uy] = center(sub);
  const P = APP.passed;
  const keysCam: [number, Cam][] = [
    [0, { x: 960, y: 540, k: 1 }],
    [tTests + 0.2, frame(news, 70, 2.0)],
    [okAt, frame(news, 70, 2.0)],
    [okAt + 0.4, frame(res, 220, 3.0)],
    [tPass - 0.4, frame(res, 220, 3.0)],
    [tPass + 0.3, frame(pageBox(P.verdict, 0), 90, 1.75)],
    [cardsAt - 0.4, frame(pageBox(P.verdict, 0), 90, 1.75)],
    [cardsAt + 0.4, { x: 960, y: 540, k: 0.7 }],
  ];
  const cam = camAt(t, keysCam);
  const ptr = along(t, [
    [tTests, 1600, 980],
    [typeAt - 0.2, ex - 60, ey + 4],
    [subAt - 0.1, ux, uy],
    [subAt + 2, ux + 2, uy + 2],
  ]);
  const down = Math.max(press(t, typeAt - 0.15), press(t, subAt));
  const img = shopImage(t, { base: "cap/shop/shop-count1-rest.jpg", typeAt, cps: 16, okAt });
  const boardOut = ramp(t, tTests - 0.6, tTests, EIO);
  const cards = [
    { at: tFound, n: "01", title: "Kane found the problem", sub: "in the real browser", icon: "browser" },
    { at: tFixed, n: "02", title: "Claude Code fixed it", sub: "one line, pushed", icon: "term" },
    { at: tProved, n: "03", title: "Kane proved the fix", sub: "every claim passes", icon: "check" },
  ];
  const end = ramp(t, 17.4, 18.8, EIO);
  return (
    <AbsoluteFill>
      <Stage />
      {/* Opening beat: the live board, checking again. */}
      <div style={{ position: "absolute", inset: 0, opacity: 1 - boardOut, filter: `blur(${boardOut * 12}px)`, transform: `scale(${mix(1, 0.9, boardOut)})` }}>
        <div style={{ position: "absolute", left: 960 - 553, top: 300, width: 553 * 2, height: 318 * 2, borderRadius: 24, overflow: "hidden", boxShadow: "0 50px 110px rgba(15,18,25,0.2)" }}>
          <div style={{ transform: `scale(2) translate(${-pageBox(APP.running.board).x}px, ${-pageBox(APP.running.board).y}px)`, transformOrigin: "0 0", position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }}>
            <LiveBoard t={t} timer={t + 3} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 150 }}>
          <Words t={t} text="Kane checks again." at={0.2} stagger={0.09} size={76} />
        </div>
      </div>
      <div style={{ position: "absolute", inset: 0, opacity: shopIn * (1 - pullOut), filter: `blur(${(1 - shopIn) * 10 + pullOut * 12}px)` }}>
        <Camera t={t} keys={keysCam}>
          <div style={{ position: "absolute", inset: 0, transform: `translateY(${(1 - E(shopIn)) * 200}px) scale(${mix(0.92, 1, E(shopIn))})` }}>
            <Window src={img} url={SHOP_URL} win={SHOP_WIN} />
          </div>
          <div style={{ position: "absolute", inset: 0, transform: `translateX(${(1 - E(passIn)) * 1700}px)`, opacity: passIn > 0 ? 1 : 0, filter: `blur(${(1 - passIn) * 14}px)` }}>
            <Window src="cap/app/passed.jpg" url={`${APP_URL}/app/check`} />
          </div>
          <Tag x={res.x + res.w + 30} y={res.y + 13} t={t} at={okAt + 0.3} out={tPass - 0.4} text="Works now" k={cam.k} />
          <Pointer x={ptr[0]} y={ptr[1]} down={down} label="Kane CLI" k={cam.k} opacity={ramp(t, tTests, tTests + 0.3) * (1 - ramp(t, tPass - 0.5, tPass - 0.2))} />
          <ClickRing x={ptr[0]} y={ptr[1]} t={t} at={subAt} k={cam.k} />
        </Camera>
      </div>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${mix(1, 0.4, end)})`, opacity: 1 - end, filter: `blur(${end * 14}px)` }}>
        {cards.map((c, i) => (
          <Card key={i} t={t} at={c.at - 0.15} x={180 + i * 540} y={360} w={480} h={360}>
            <div style={{ font: `500 20px ${MONO}`, color: GRAY }}>{c.n}</div>
            <div style={{ marginTop: 34 }}><Icon kind={c.icon} p={ramp(t, c.at + 0.2, c.at + 0.9)} /></div>
            <div style={{ font: `700 36px ${SANS}`, letterSpacing: "-0.035em", color: INK, marginTop: 30 }}>{c.title}</div>
            <div style={{ font: `400 24px ${SANS}`, color: GRAY, marginTop: 8 }}>{c.sub}</div>
          </Card>
        ))}
      </div>
      {white(1 - ramp(t, 0, 0.5))}
      <Sfx at={tTests - 0.6} src={S.whoosh} volume={0.4} />
      <Sfx at={typeAt - 0.15} src={S.click} volume={0.6} />
      <Keys start={typeAt} n={15} cps={16} />
      <Sfx at={subAt} src={S.click} volume={0.65} />
      <Sfx at={okAt} src={S.copy} volume={0.45} />
      <Sfx at={tPass - 0.5} src={S.swish} volume={0.4} />
      <Sfx at={tPass} src={S.pass} volume={0.6} />
      {cards.map((c, i) => <Sfx key={i} at={c.at - 0.1} src={S.card} volume={0.35} />)}
      <Sfx at={17.4} src={S.whoosh} volume={0.4} />
    </AbsoluteFill>
  );
}

// ================================================================== 11. Close (HyperFrames card)

export function Close() {
  const t = useT();
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      <OffthreadVideo src={staticFile("hf/outro.mp4")} muted style={{ width: 1920, height: 1080 }} />
      <Sfx at={0.05} src={S.swish} volume={0.35} />
      <Sfx at={1.05} src={S.pop} volume={0.3} />
      {white(ramp(t, 16.6, 17.9))}
    </AbsoluteFill>
  );
}
