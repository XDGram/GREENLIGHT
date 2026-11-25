import React from "react";
import { AbsoluteFill } from "remotion";
import { say } from "../timeline";
import { BACK, Burst, Camera, Chapter, clamp01, Click, Cursor, cursorAt, Flash, glitchAt, IN, mix, MONO, OUT, press, punchAt, ramp, SANS, Sfx, shakeAt, Shockwave, Slam, Sweep, Tag, typed, Typing, useT, Words } from "./kit";
import { AppBar, Badge, Button, C, ClaimRow, Field, KaneCore, Night, ORANGE, Shop, Sky, Step, Terminal, Window, Wordmark } from "./ui";

// The eleven shots. Every action is timed to the spoken word with say(scene, phrase).
// World coordinates are on a 1920 × 1080 stage; the camera pushes in on each click.

const WIN = { x: 160, y: 80, w: 1600, h: 920 };
const APP = "greenlight-api-xi.vercel.app";

// ================================================================== 1. The promise

export function Promise() {
  const t = useT();
  const a = say("promise", "Every app");
  const add = say("promise", "Add to cart");
  const sign = say("promise", "Sign up");
  const but = say("promise", "But does");
  const keep = say("promise", "keep them");
  const card = add - 0.45;
  const cardOut = but - 0.2;
  const cardP = ramp(t, card, card + 0.8);
  const cardGone = ramp(t, cardOut, cardOut + 0.5, IN);
  const l2 = typed("- Add to cart", t, add - 0.1, 30);
  const l3 = typed("- Sign up for the newsletter", t, sign - 0.1, 34);
  const end = 10.3;
  return (
    <AbsoluteFill>
      <Night t={t} />
      <Camera
        shots={[
          [0, 960, 540, 1],
          [card, 960, 540, 1.0],
          [add - 0.2, 760, 520, 1.35],
          [sign - 0.2, 860, 590, 1.35],
          [cardOut - 0.1, 960, 540, 1],
          [end - 0.6, 960, 540, 1.18],
        ]}
        travel={0.8}
        punch={punchAt(t, add) + punchAt(t, sign) + punchAt(t, keep - 0.1, 0.06)}
      >
        <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
          <div style={{ opacity: 1 - ramp(t, card - 0.4, card, IN) }}>
            <Words text="Every app has a README" t={t} at={a - 0.05} size={104} />
            <Words text="full of promises." t={t} at={a + 0.5} size={104} hl={{ promises: C.green }} />
          </div>
        </AbsoluteFill>
        {cardP > 0 && cardGone < 1 ? (
          <div
            style={{
              position: "absolute",
              left: 520,
              top: 330,
              width: 880,
              height: 420,
              borderRadius: 26,
              background: "linear-gradient(160deg, rgba(30,38,54,0.92), rgba(12,16,24,0.92))",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.09), 0 40px 100px rgba(0,0,0,0.55)",
              padding: "34px 44px",
              transform: `translateY(${(1 - cardP) * 80}px) scale(${mix(0.9, 1, cardP) - cardGone * 0.1})`,
              opacity: cardP * (1 - cardGone),
              filter: `blur(${cardGone * 14}px)`,
              font: `400 34px/1.9 ${MONO}`,
              color: "#e8ecf3",
            }}
          >
            <div style={{ font: `500 18px ${MONO}`, color: "#7f8899", marginBottom: 10 }}>README.md</div>
            <div style={{ color: "#8ea4ff" }}># Demo Shop</div>
            <div>{l2}</div>
            <div>{l3}</div>
          </div>
        ) : null}
        <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
          <div>
            <Words text="But does the live app" t={t} at={but} size={96} out={end - 0.25} />
            <Words text="actually keep them?" t={t} at={keep - 0.35} size={128} hl={{ keep: C.green }} out={end - 0.25} />
          </div>
        </AbsoluteFill>
      </Camera>
      <Burst x={960} y={540} t={t} at={end} color={C.green} />
      <Typing start={add - 0.1} text="- Add to cart" cps={30} />
      <Typing start={sign - 0.1} text="- Sign up for the newsletter" cps={34} />
      <Chapter n="01" name="The promise" t={t} at={0.3} out={2.4} />
      <Sfx at={card} name="whoosh" volume={0.3} />
      <Sfx at={add} name="pop" volume={0.3} />
      <Sfx at={sign} name="pop" volume={0.3} />
      <Sfx at={keep - 0.1} name="sub" volume={0.6} />
      <Sfx at={end - 0.5} name="riser" volume={0.4} />
    </AbsoluteFill>
  );
}

// ================================================================== 2. Greenlight

export function Brand() {
  const t = useT();
  const hit = 0.35;
  const tag = say("brand", "It checks every promise") - 0.2;
  const kane = say("brand", "using Kane CLI");
  const claude = say("brand", "and Claude Code");
  const p = ramp(t, hit, hit + 0.55);
  return (
    <AbsoluteFill>
      <Sky t={t} />
      <Camera shots={[[0, 960, 540, 1], [2, 960, 540, 1.06], [12, 960, 520, 1.12]]} travel={6} shake={shakeAt(t, hit + 0.1, 12)} punch={punchAt(t, kane, 0.03) + punchAt(t, claude, 0.03)}>
        <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 40 }}>
          <div style={{ transform: `scale(${mix(2.4, 1, p)})`, filter: `blur(${(1 - p) * 26}px)`, opacity: clamp01(p * 2) }}>
            <Wordmark h={190} />
          </div>
          <Words text="Does your app do what its README says?" t={t} at={tag} size={50} weight={600} per={0.05} />
          <div style={{ display: "flex", gap: 22, minHeight: 80 }}>
            <Tag text="Kane CLI tests it" t={t} at={kane} color="#ffffff" ink={C.ink} size={30} />
            <Tag text="Claude Code fixes it" t={t} at={claude} color={C.green} size={30} />
          </div>
        </AbsoluteFill>
      </Camera>
      <Shockwave x={960} y={460} t={t} at={hit + 0.1} color="#ffffff" />
      <Flash t={t} at={hit + 0.05} max={0.55} />
      <Sfx at={hit} name="boom" volume={0.85} />
      <Chapter n="02" name="Greenlight" t={t} at={1.2} out={3.6} />
      <Sfx at={kane} name="tick" volume={0.3} />
      <Sfx at={claude} name="tick" volume={0.3} />
    </AbsoluteFill>
  );
}

// ================================================================== 3. Start a check

const REPO = "github.com/XDGram/demo-shop";
const LIVE = "greenlight-demo-shop.vercel.app";
const README = "# Demo Shop\n- Users can add items to the cart\n- Users can subscribe to the newsletter";

export function Start() {
  const t = useT();
  const r = say("start", "your code on GitHub") - 0.2;
  const u = say("start", "the link to your live app") - 0.2;
  const m = say("start", "and your README") - 0.1;
  const all = say("start", "That's all");
  const noAcc = say("start", "No account");
  const noSet = say("start", "no setup");
  const clickAt = 11.0;
  const cur = cursorAt(t, [
    [0, 1300, 900],
    [r - 0.1, 560, 395],
    [u - 0.1, 1320, 395],
    [m - 0.1, 950, 600],
    [clickAt, 330, 862],
  ]);
  const repo = typed(REPO, t, r + 0.25, 32);
  const live = typed(LIVE, t, u + 0.25, 34);
  const pasted = ramp(t, m + 0.2, m + 0.7);
  return (
    <AbsoluteFill>
      <Sky t={t + 20} />
      <Camera
        shots={[
          [0, 960, 540, 1.08],
          [r - 0.25, 600, 400, 1.75],
          [u - 0.25, 1300, 400, 1.75],
          [m - 0.25, 960, 610, 1.4],
          [all, 960, 520, 1.1],
          [clickAt - 0.8, 420, 820, 1.7],
        ]}
        travel={0.7}
        shake={shakeAt(t, clickAt, 8)}
        punch={punchAt(t, m + 0.2, 0.04)}
      >
        <Window {...WIN} url={APP}>
          <AppBar />
          <div style={{ padding: "34px 60px", display: "flex", flexDirection: "column", gap: 26 }}>
            <div style={{ font: `800 44px ${SANS}`, letterSpacing: "-0.035em", color: C.ink }}>Check an app</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30 }}>
              <Field label="GitHub repository" value={repo} icon="⌥" focus={t > r && t < u ? 1 : 0} placeholder="github.com/you/your-app" />
              <Field label="Live app URL" value={live} icon="🌐" focus={t > u && t < m ? 1 : 0} placeholder="your-app.vercel.app" />
            </div>
            <div style={{ opacity: 1, position: "relative" }}>
              <Field label="README" value={pasted > 0 ? README : ""} mono h={200} placeholder="Paste your README, or leave it empty" focus={t > m && t < all ? 1 : 0} />
              {pasted > 0 && pasted < 1 ? <div style={{ position: "absolute", inset: "34px 0 0 0", borderRadius: 16, background: C.green, opacity: (1 - pasted) * 0.35 }} /> : null}
            </div>
            <div>
              <Button text="Check my app" down={press(t, clickAt)} glow={pulseGlow(t, clickAt - 1.2, clickAt)} />
            </div>
          </div>
        </Window>
        <Cursor x={cur[0]} y={cur[1]} down={press(t, clickAt)} />
        <Click x={cur[0]} y={cur[1]} t={t} at={clickAt} />
        <Shockwave x={330} y={862} t={t} at={clickAt} color={C.green} max={700} />
        <Sweep t={t} at={0.2} {...WIN} />
        <Sweep t={t} at={m + 0.3} x={220} y={470} w={1480} h={300} alpha={0.6} />
      </Camera>
      <Chapter n="03" name="Start a check" t={t} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 110, display: "flex", justifyContent: "center", gap: 20 }}>
        <Tag text="No account" t={t} at={noAcc} out={clickAt - 1.4} size={34} />
        <Tag text="No setup" t={t} at={noSet} out={clickAt - 1.4} size={34} color="#fff" ink={C.ink} />
      </div>
      <Typing start={r + 0.25} text={REPO} cps={32} />
      <Typing start={u + 0.25} text={LIVE} cps={34} />
      <Sfx at={m + 0.2} name="tick" volume={0.35} />
      <Sfx at={clickAt} name="click" volume={0.55} />
      <Sfx at={clickAt + 0.02} name="impact" volume={0.35} />
      <Sfx at={11.4} name="whoosh" volume={0.45} />
      <Sfx at={r - 0.25} name="swish" volume={0.25} />
      <Sfx at={u - 0.25} name="swish" volume={0.25} />
      <Sfx at={m + 0.2} name="hit" volume={0.35} />
    </AbsoluteFill>
  );
}

const pulseGlow = (t: number, a: number, b: number) => ramp(t, a, a + 0.4) * (0.6 + 0.4 * Math.sin(t * 9)) * (t < b + 0.3 ? 1 : 0);

// ================================================================== 4. Claims

export function Claims() {
  const t = useT();
  const turns = say("claims", "Greenlight turns each promise") - 0.1;
  const choose = say("claims", "You choose which ones");
  const cost = say("claims", "what the run will cost") - 0.2;
  const nothing = say("claims", "Nothing runs until");
  const run = say("claims", "you press Run") + 0.25;
  const toggle = choose + 0.7;
  const cur = cursorAt(t, [
    [0, 1500, 950],
    [toggle, 312, 472],
    [run, 1426, 846],
  ]);
  const off = ramp(t, toggle, toggle + 0.15) * (1 - ramp(t, toggle + 0.9, toggle + 1.05));
  const n = Math.round(94 * ramp(t, cost, cost + 1.2, OUT));
  return (
    <AbsoluteFill>
      <Sky t={t + 32} />
      <Camera
        shots={[
          [0, 960, 470, 1.12],
          [turns + 0.4, 960, 470, 1.14],
          [toggle - 0.6, 520, 480, 1.6],
          [cost - 0.4, 1240, 820, 1.55],
          [nothing - 0.2, 960, 520, 1.1],
          [run - 0.7, 1380, 830, 1.8],
        ]}
        travel={0.75}
        shake={shakeAt(t, run, 18, 0.6)}
        punch={punchAt(t, turns + 0.2, 0.03) + punchAt(t, cost + 1.2, 0.04)}
      >
        <Window {...WIN} url={APP}>
          <AppBar />
          <div style={{ padding: "34px 60px", display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
              <div style={{ font: `800 44px ${SANS}`, letterSpacing: "-0.035em", color: C.ink }}>Choose what Kane checks</div>
              <span style={{ font: `600 20px ${SANS}`, color: C.muted }}>2 claims found in README.md</span>
            </div>
            <ClaimRow n="01" text="Users can add items to the cart and the cart count goes up" sub="Kane will click Add item and check the count goes up." p={ramp(t, turns, turns + 0.7, BACK)} />
            <ClaimRow n="02" text="Users can subscribe to the newsletter and see a confirmation" sub="Kane will enter an email, click Subscribe, and look for a confirmation." on={1 - off} p={ramp(t, turns + 0.18, turns + 0.88, BACK)} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 26, padding: "26px 32px", borderRadius: 22, background: C.soft, opacity: ramp(t, cost - 0.3, cost + 0.2) }}>
              <div>
                <div style={{ font: `600 20px ${SANS}`, color: C.muted }}>This run costs</div>
                <div style={{ font: `800 64px ${SANS}`, letterSpacing: "-0.04em", color: C.ink }}>
                  {n} <span style={{ font: `600 24px ${SANS}`, color: C.muted }}>Kane credits</span>
                </div>
              </div>
              <Button text="Run" sub="94 credits" kind="green" down={press(t, run)} glow={pulseGlow(t, nothing, run)} />
            </div>
          </div>
        </Window>
        <Cursor x={cur[0]} y={cur[1]} down={Math.max(press(t, toggle), press(t, toggle + 0.95), press(t, run))} />
        <Click x={cur[0]} y={cur[1]} t={t} at={toggle} color={C.blue} />
        <Click x={cur[0]} y={cur[1]} t={t} at={toggle + 0.95} color={C.blue} />
        <Click x={cur[0]} y={cur[1]} t={t} at={run} />
        <Sweep t={t} at={turns + 0.7} x={220} y={290} w={1480} h={260} alpha={0.55} />
      </Camera>
      <Chapter n="04" name="Claims" t={t} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 64 }}>
        <Words text="Nothing runs until you press Run." t={t} at={nothing} size={58} weight={800} per={0.05} hl={{ Run: C.green }} out={run - 0.15} />
      </div>
      <Shockwave x={960} y={540} t={t} at={run + 0.05} color={C.green} max={1500} rings={4} />
      <Burst x={960} y={540} t={t} at={run + 0.05} color={C.green} />
      <Flash t={t} at={run + 0.1} max={0.7} />
      <Sfx at={toggle} name="click" volume={0.35} />
      <Sfx at={toggle + 0.95} name="click" volume={0.35} />
      <Sfx at={cost} name="tick" volume={0.3} />
      <Sfx at={run} name="click" volume={0.55} />
      <Sfx at={run + 0.03} name="boom" volume={0.9} />
      <Sfx at={turns} name="pop" volume={0.3} />
      <Sfx at={turns + 0.18} name="pop" volume={0.3} />
      <Sfx at={cost + 1.2} name="hit" volume={0.4} />
    </AbsoluteFill>
  );
}

// ================================================================== 5. Kane CLI tests it

export function Kane() {
  const t = useT();
  const intro = say("kane", "This is where Kane CLI");
  const hands = say("kane", "Greenlight hands it");
  const opens = say("kane", "Kane opens your live app") - 0.3;
  const clicks = say("kane", "it clicks");
  const types = say("kane", "it types");
  const reads = say("kane", "it reads");
  const works = say("kane", "The cart works");
  const no = say("kane", "But the newsletter");
  const sayNo = say("kane", "keeps saying no");
  const dive = opens - 0.2; // the camera flies into the Kane core and out into the browser
  const addAt = clicks + 0.1;
  const typeAt = types - 0.2;
  const subAt = reads + 0.6;
  const sub2 = sayNo + 0.1;
  const fail1 = subAt + 0.35;
  const fail2 = sub2 + 0.35;
  const email = typed("ada@example.com", t, typeAt + 0.3, 26);
  const msg = t > fail1 && !(t > sub2 && t < fail2) ? "fail" : undefined;
  const inBrowser = t >= dive + 0.5;
  // Browser world coordinates (window at WIN): Add item ≈ (420, 640), email ≈ (1130, 470), Subscribe ≈ (1500, 470), cart ≈ (1640, 210).
  const cur = cursorAt(t, [
    [dive + 0.6, 1500, 900],
    [addAt, 420, 650],
    [typeAt, 1080, 478],
    [subAt, 1520, 478],
    [sub2, 1522, 480],
  ]);
  const pills = ramp(t, hands, hands + 1.2, IO2);
  return (
    <AbsoluteFill>
      {!inBrowser ? (
        <>
          <Night t={t} tint="#123a6a" accent="#0d5a37" />
          <Camera shots={[[0, 960, 540, 1], [hands, 960, 540, 1.1], [dive, 960, 540, 7]]} travel={0.7}>
            <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
              <div style={{ transform: `scale(${mix(0.4, 1, ramp(t, 0.1, 0.7, BACK))})`, opacity: ramp(t, 0.1, 0.5) }}>
                <KaneCore t={t} power={0.5 + 0.5 * ramp(t, hands + 1, hands + 1.4)} />
              </div>
            </AbsoluteFill>
            {[
              ["Add items to the cart", -1],
              ["Subscribe to the newsletter", 1],
            ].map(([txt, side], i) => {
              const s = side as number;
              const x = mix(960 + s * 620, 960, pills);
              const y = 300 + i * 480 - mix(0, (i ? 1 : -1) * 240, pills);
              return (
                <div key={i} style={{ position: "absolute", left: x, top: y, transform: `translate(-50%,-50%) scale(${1 - pills * 0.7})`, opacity: ramp(t, hands - 0.2, hands + 0.2) * (1 - ramp(t, hands + 1, hands + 1.25)), padding: "18px 28px", borderRadius: 18, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.2)", color: "#fff", font: `700 30px ${SANS}`, whiteSpace: "nowrap" }}>
                  {txt as string}
                </div>
              );
            })}
          </Camera>
          <div style={{ position: "absolute", left: 0, right: 0, top: 120 }}>
            <Words text="Kane CLI" t={t} at={intro + 0.25} size={70} hl={{ Kane: C.green }} out={hands - 0.3} />
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 110 }}>
            <Words text="every claim, as a plain-English test" t={t} at={hands + 0.4} size={46} weight={600} per={0.05} out={dive - 0.2} hl={{ "plainEnglish": C.green }} />
          </div>
          <Shockwave x={960} y={540} t={t} at={hands + 1.15} color={C.green} max={900} />
          <Chapter n="05" name="Kane CLI tests it" t={t} at={0.4} out={3} />
          <Flash t={t} at={dive + 0.2} len={0.3} max={1} />
        </>
      ) : (
        <>
          <Night t={t} tint="#16305e" accent="#0d4a30" />
          <Camera
            shots={[
              [dive + 0.5, 960, 540, 1.25],
              [dive + 0.7, 960, 540, 1],
              [addAt - 0.7, 520, 600, 1.7],
              [typeAt - 0.6, 1300, 480, 1.7],
              [works - 0.1, 1500, 330, 1.4],
              [no - 0.1, 1250, 520, 1.55],
            ]}
            travel={0.7}
            shake={shakeAt(t, fail1, 16, 0.5) + shakeAt(t, fail2, 16, 0.5)}
            glitch={glitchAt(t, fail1) + glitchAt(t, fail2, 0.45)}
            punch={punchAt(t, addAt + 0.1, 0.04) + punchAt(t, works, 0.035)}
          >
            <Window {...WIN} url={LIVE}>
              <Shop count={t > addAt + 0.1 ? 1 : 0} email={email} msg={msg} adding={ramp(t, addAt + 0.1, addAt + 0.3) * (1 - ramp(t, addAt + 0.3, addAt + 0.7))} />
            </Window>
            <div style={{ position: "absolute", left: 1550, top: 120, opacity: ramp(t, works - 0.1, works + 0.3) }}>
              <Tag text="✓ Works" t={t} at={works - 0.1} size={26} />
            </div>
            <Cursor x={cur[0]} y={cur[1]} down={Math.max(press(t, addAt), press(t, subAt), press(t, sub2))} label="Kane CLI" />
            <Click x={cur[0]} y={cur[1]} t={t} at={addAt} />
            <Click x={cur[0]} y={cur[1]} t={t} at={subAt} color={C.red} />
            <Click x={cur[0]} y={cur[1]} t={t} at={sub2} color={C.red} />
            <Shockwave x={1260} y={560} t={t} at={fail1} color={C.red} max={500} rings={2} />
            <Shockwave x={1260} y={560} t={t} at={fail2} color={C.red} max={500} rings={2} />
          </Camera>
          <div style={{ position: "absolute", left: 70, top: 60, display: "flex", gap: 14 }}>
            <Tag text="Clicks" t={t} at={clicks} color="#fff" ink={C.ink} size={28} />
            <Tag text="Types" t={t} at={types} color="#fff" ink={C.ink} size={28} />
            <Tag text="Reads" t={t} at={reads} color="#fff" ink={C.ink} size={28} />
          </div>
          <Flash t={t} at={fail1} len={0.4} color={C.red} max={0.25} />
          <Flash t={t} at={fail2} len={0.4} color={C.red} max={0.3} />
          <Flash t={t} at={dive + 0.5} len={0.55} max={1} />
        </>
      )}
      <Sfx at={0.1} name="impact" volume={0.6} />
      <Sfx at={hands + 1.1} name="whoosh" volume={0.4} />
      <Sfx at={dive} name="riser" volume={0.3} />
      <Sfx at={dive + 0.5} name="impact" volume={0.6} />
      <Sfx at={addAt} name="click" volume={0.5} />
      <Sfx at={addAt + 0.12} name="tick" volume={0.3} />
      <Typing start={typeAt + 0.3} text="ada@example.com" cps={26} />
      <Sfx at={subAt} name="click" volume={0.5} />
      <Sfx at={fail1} name="fail" volume={0.45} />
      <Sfx at={fail1} name="glitch" volume={0.55} />
      <Sfx at={fail2} name="glitch" volume={0.6} />
      <Sfx at={fail2 + 0.05} name="sub" volume={0.55} />
      <Sfx at={works} name="pop" volume={0.4} />
      <Sfx at={hands} name="swish" volume={0.3} />
      <Sfx at={hands + 1.15} name="hit" volume={0.55} />
      <Sfx at={sub2} name="click" volume={0.5} />
      <Sfx at={fail2} name="fail" volume={0.5} />
    </AbsoluteFill>
  );
}

const IO2 = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// ================================================================== 6. The verdict

const SAW = "Three valid email submissions all returned “Subscription failed. Please try again later.”";

export function Verdict() {
  const t = useT();
  const here = say("verdict", "And here is the verdict");
  const pass = say("verdict", "The cart passed");
  const fail = say("verdict", "The newsletter failed");
  const saw = say("verdict", "exactly what it saw") - 0.3;
  const fix = say("verdict", "It brings up the fix") - 0.2;
  return (
    <AbsoluteFill>
      <Sky t={t + 60} />
      <Camera
        shots={[
          [0, 960, 470, 1.12],
          [pass - 0.5, 700, 420, 1.45],
          [fail - 0.4, 700, 560, 1.45],
          [saw - 0.2, 700, 700, 1.5],
          [fix - 0.4, 1420, 560, 1.5],
        ]}
        travel={0.7}
        shake={shakeAt(t, pass, 8) + shakeAt(t, fail, 14)}
        glitch={glitchAt(t, fail, 0.3)}
        punch={punchAt(t, pass, 0.035) + punchAt(t, saw + 0.3, 0.03) + punchAt(t, fix + 0.4, 0.04)}
      >
        <Window {...WIN} url={APP}>
          <AppBar active="My checks" />
          <div style={{ padding: "30px 60px", display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 34 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 18, opacity: ramp(t, here - 0.2, here + 0.4) }}>
                <div style={{ font: `800 44px ${SANS}`, letterSpacing: "-0.035em" }}>Demo Shop</div>
                <span style={{ font: `600 18px ${SANS}`, color: C.muted }}>Verdict · tested by Kane CLI</span>
              </div>
              <ClaimRow n="01" text="Add items to the cart" sub="The count went from 0 to 1." status={t > pass ? "pass" : "run"} p={ramp(t, here, here + 0.6, BACK)} />
              <div>
                <ClaimRow n="02" text="Subscribe to the newsletter" sub="No confirmation appeared." status={t > fail ? "fail" : "run"} p={ramp(t, here + 0.15, here + 0.75, BACK)} />
                <div style={{ overflow: "hidden", height: mix(0, 170, ramp(t, saw, saw + 0.6)), marginTop: 12 }}>
                  <div style={{ padding: "22px 28px", borderRadius: 18, background: C.redSoft, border: "1.5px solid #ffd4cc" }}>
                    <div style={{ font: `800 18px ${SANS}`, color: C.redInk, letterSpacing: "0.04em", textTransform: "uppercase" }}>What Kane saw</div>
                    <div style={{ marginTop: 8, font: `600 24px/1.45 ${SANS}`, color: C.ink }}>{SAW}</div>
                  </div>
                </div>
              </div>
            </div>
            <div
              style={{
                alignSelf: "start",
                marginTop: 80,
                padding: 30,
                borderRadius: 24,
                background: C.ink,
                color: "#fff",
                transform: `translateY(${(1 - ramp(t, fix, fix + 0.6, BACK)) * 60}px)`,
                opacity: ramp(t, fix, fix + 0.4),
                boxShadow: `0 0 ${70 * ramp(t, fix + 0.4, fix + 1)}px rgba(46,230,138,0.45)`,
              }}
            >
              <div style={{ font: `600 18px ${SANS}`, color: C.green }}>Ready for Claude Code</div>
              <div style={{ marginTop: 8, font: `800 34px/1.15 ${SANS}`, letterSpacing: "-0.03em" }}>Fix it with Claude Code</div>
              <div style={{ marginTop: 12, font: `500 20px/1.5 ${SANS}`, color: "#aeb6c4" }}>One message. Claude Code fixes what failed and asks Kane to check again.</div>
              <div style={{ marginTop: 22 }}>
                <Button text="Connect Claude Code" kind="green" />
              </div>
            </div>
          </div>
        </Window>
        <Shockwave x={1280} y={430} t={t} at={pass} color={C.green} max={420} rings={2} />
        <Shockwave x={1280} y={560} t={t} at={fail} color={C.red} max={520} rings={3} />
        <Sweep t={t} at={here + 0.3} {...WIN} />
        <Sweep t={t} at={fix + 0.5} x={1180} y={360} w={560} h={420} alpha={0.6} />
      </Camera>
      <Chapter n="06" name="The verdict" t={t} />
      <Sfx at={pass} name="pass" volume={0.4} />
      <Sfx at={fail} name="fail" volume={0.5} />
      <Sfx at={fail + 0.02} name="glitch" volume={0.5} />
      <Sfx at={pass} name="hit" volume={0.35} />
      <Sfx at={saw} name="swish" volume={0.3} />
      <Sfx at={fix + 0.4} name="hit" volume={0.45} />
      <Sfx at={fix} name="whoosh" volume={0.35} />
    </AbsoluteFill>
  );
}

// ================================================================== 7. First time: install

const INSTALL = "curl -fsSL https://claude.ai/install.sh | bash";

export function Install() {
  const t = useT();
  const first = say("install", "First time using Claude Code");
  const copy = say("install", "Copy one line") + 0.3;
  const ready = say("install", "Claude Code is ready") - 0.3;
  const once = say("install", "You only do this once");
  const cur = cursorAt(t, [
    [0, 1400, 900],
    [copy, 1484, 555],
  ]);
  const term = ramp(t, ready, ready + 0.8, OUT);
  return (
    <AbsoluteFill>
      <Night t={t} tint="#16305e" accent="#3a2a12" />
      <Camera shots={[[0, 960, 540, 1], [copy - 0.7, 1300, 540, 1.6], [ready - 0.2, 960, 540, 1]]} travel={0.7} punch={punchAt(t, copy + 0.05, 0.045) + punchAt(t, ready + 0.7, 0.03)}>
        <div style={{ position: "absolute", left: 330, top: 260, width: 1260, padding: "44px 52px", borderRadius: 28, background: "#fff", boxShadow: "0 50px 120px rgba(0,0,0,0.5)", transform: `scale(${mix(0.9, 1, ramp(t, 0, 0.6)) - term * 0.15}) translateY(${-term * 260}px)`, opacity: 1 - term, filter: `blur(${term * 16}px)` }}>
          <div style={{ font: `600 20px ${SANS}`, color: C.blue }}>First time?</div>
          <div style={{ marginTop: 6, font: `800 46px ${SANS}`, letterSpacing: "-0.035em", color: C.ink }}>Install Claude Code</div>
          <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 18, padding: "22px 26px", borderRadius: 18, background: "#0f1218" }}>
            <span style={{ flex: 1, font: `400 26px ${MONO}`, color: "#e6e8eb" }}>{INSTALL}</span>
            <span style={{ padding: "12px 20px", borderRadius: 12, background: t > copy ? C.green : "#262b34", color: t > copy ? "#04130b" : "#fff", font: `700 20px ${SANS}`, transform: `scale(${1 - 0.08 * press(t, copy)})` }}>{t > copy ? "✓ Copied" : "Copy"}</span>
          </div>
        </div>
        <Cursor x={cur[0]} y={cur[1]} down={press(t, copy)} opacity={1 - ramp(t, ready - 0.3, ready)} />
        <Click x={cur[0]} y={cur[1]} t={t} at={copy} />
        {term > 0 ? (
          <Terminal x={410} y={mix(1100, 260, term)} w={1100} h={600} style={{ opacity: term }}>
            <div style={{ border: `1.5px solid ${ORANGE}`, borderRadius: 12, padding: "18px 22px" }}>
              <span style={{ color: ORANGE }}>✻</span> Welcome to <b>Claude Code</b>!
              <div style={{ color: "#7d8594", fontSize: 21, marginTop: 6 }}>/help for help · cwd: ~/demo-shop</div>
            </div>
            <div style={{ marginTop: 26, color: "#7d8594" }}>&gt; <span style={{ display: "inline-block", width: 13, height: 26, background: "#e6e8eb", verticalAlign: "-4px", opacity: Math.floor(t * 2) % 2 }} /></div>
          </Terminal>
        ) : null}
      </Camera>
      <div style={{ position: "absolute", left: 0, right: 0, top: 120 }}>
        <Words text="First time? Greenlight walks you through it." t={t} at={first + 0.1} size={52} weight={700} per={0.05} out={copy - 0.4} hl={{ Greenlight: C.green }} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 70 }}>
        <Words text="You only do this once." t={t} at={once} size={64} hl={{ once: C.green }} />
      </div>
      <Sfx at={copy} name="click" volume={0.5} />
      <Sfx at={copy + 0.1} name="tick" volume={0.3} />
      <Sfx at={ready} name="whoosh" volume={0.4} />
      <Sfx at={ready + 0.7} name="hit" volume={0.4} />
      <Chapter n="07" name="First time" t={t} />
    </AbsoluteFill>
  );
}

// ================================================================== 8. One paste

const MSG = "Use Greenlight to fix my app until Kane CLI passes every claim.";

export function Paste() {
  const t = useT();
  const click = say("paste", "click Connect Claude Code") + 0.4;
  const copy = say("paste", "copy one message") + 0.2;
  const paste = say("paste", "and paste it into Claude Code") + 0.4;
  const talk = say("paste", "That message is all it needs");
  const enter = talk + 1.0;
  const fly = ramp(t, copy + 0.25, paste, IO2);
  const cur = cursorAt(t, [
    [0, 700, 900],
    [click, 470, 470],
    [copy, 780, 790],
  ]);
  const shown = t > click + 0.15;
  const fx = mix(640, 1380, fly);
  const fy = mix(690, 610, fly) - Math.sin(fly * Math.PI) * 260;
  return (
    <AbsoluteFill>
      <Night t={t} tint="#14325f" accent="#3a2a12" />
      <Camera shots={[[0, 960, 540, 1], [click - 0.7, 560, 520, 1.5], [copy - 0.6, 640, 700, 1.5], [copy + 0.3, 960, 540, 1], [enter - 0.6, 1360, 520, 1.35]]} travel={0.7} shake={shakeAt(t, paste, 12)} punch={punchAt(t, click + 0.15, 0.035) + punchAt(t, enter, 0.04)}>
        <div style={{ position: "absolute", left: 120, top: 200, width: 840, height: 700, borderRadius: 28, background: "#fff", padding: "40px 44px", boxShadow: "0 50px 120px rgba(0,0,0,0.5)" }}>
          <div style={{ font: `600 20px ${SANS}`, color: C.blue }}>Close the loop</div>
          <div style={{ marginTop: 6, font: `800 42px ${SANS}`, letterSpacing: "-0.035em", color: C.ink }}>Fix it with Claude Code</div>
          <div style={{ marginTop: 26 }}>
            <Button text="Connect Claude Code" kind="dark" down={press(t, click)} />
          </div>
          <div style={{ marginTop: 28, overflow: "hidden", height: mix(0, 300, ramp(t, click + 0.15, click + 0.7)) }}>
            <div style={{ borderRadius: 18, background: "#0f1218", padding: "22px 26px", font: `400 22px/1.6 ${MONO}`, color: "#d7dbe2" }}>
              {MSG}
              <div style={{ color: "#7d8594" }}>Check: Demo Shop</div>
              <div style={{ color: "#7d8594" }}>
                Key: <span style={{ filter: "blur(7px)" }}>gl_agent_8fK2dQ9xLm4</span>
              </div>
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <span style={{ padding: "12px 22px", borderRadius: 12, background: t > copy ? C.green : C.ink, color: t > copy ? "#04130b" : "#fff", font: `700 20px ${SANS}`, transform: `scale(${1 - 0.08 * press(t, copy)})` }}>{t > copy ? "✓ Copied" : "Copy message"}</span>
            </div>
          </div>
        </div>
        <Terminal x={1020} y={200} w={780} h={700}>
          <div style={{ border: `1.5px solid ${ORANGE}`, borderRadius: 12, padding: "14px 18px", fontSize: 21 }}>
            <span style={{ color: ORANGE }}>✻</span> Welcome to <b>Claude Code</b>!
          </div>
          <div style={{ marginTop: 24, fontSize: 22 }}>
            &gt; {t > paste ? <span style={{ background: "#262b34", padding: "4px 10px", borderRadius: 6 }}>[Pasted message from Greenlight]</span> : <span style={{ color: "#5e6573" }}>Try "fix the failing claim"</span>}
          </div>
          {t > enter ? (
            <div style={{ marginTop: 22, fontSize: 22, color: ORANGE }}>
              {"✢✳✶✻✽"[Math.floor(t * 8) % 5]} <span style={{ color: "#e6e8eb" }}>Reading Kane's verdict…</span>
            </div>
          ) : null}
        </Terminal>
        {fly > 0 && fly < 1 ? (
          <div style={{ position: "absolute", left: fx, top: fy, transform: `translate(-50%,-50%) rotate(${(fly - 0.5) * 10}deg) scale(${1 + Math.sin(fly * Math.PI) * 0.25})`, padding: "16px 26px", borderRadius: 16, background: C.green, color: "#04130b", font: `800 24px ${SANS}`, boxShadow: `0 20px 50px rgba(46,230,138,0.5), ${-40 * (1 - fly)}px 0 40px rgba(46,230,138,0.25)`, filter: `blur(${Math.sin(fly * Math.PI) * 1.5}px)`, whiteSpace: "nowrap" }}>
            ✉ One message
          </div>
        ) : null}
        <Shockwave x={1400} y={560} t={t} at={paste} color={C.green} max={600} />
        <Cursor x={cur[0]} y={cur[1]} down={Math.max(press(t, click), press(t, copy))} opacity={1 - ramp(t, copy + 0.4, copy + 0.8)} />
        <Click x={cur[0]} y={cur[1]} t={t} at={click} />
        <Click x={cur[0]} y={cur[1]} t={t} at={copy} />
      </Camera>
      <div style={{ position: "absolute", left: 0, right: 0, top: 70 }}>
        <Words text="One paste." t={t} at={paste - 0.1} size={64} hl={{ paste: C.green }} out={enter + 1.4} />
      </div>
      <Sfx at={click} name="click" volume={0.5} />
      <Sfx at={copy} name="click" volume={0.5} />
      <Sfx at={copy + 0.25} name="whoosh" volume={0.5} />
      <Sfx at={paste} name="hit" volume={0.6} />
      <Sfx at={click + 0.15} name="swish" volume={0.3} />
      <Sfx at={enter + 0.1} name="data" volume={0.3} />
      <Chapter n="08" name="One paste" t={t} />
      <Sfx at={enter} name="click" volume={0.45} />
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
  const g = say("fix", "You just watch");
  const diff = c + 1.1;
  return (
    <AbsoluteFill>
      <Night t={t} tint="#1a2a4a" accent="#4a2a12" />
      <Camera
        shots={[
          [0, 960, 540, 1],
          [a + 0.6, 960, 500, 1.06],
          [diff - 0.3, 800, 620, 1.55],
          [d + 0.3, 960, 560, 1.05],
          [g - 0.4, 960, 540, 0.92],
        ]}
        travel={0.8}
        punch={punchAt(t, a, 0.02) + punchAt(t, b, 0.02) + punchAt(t, diff, 0.04) + punchAt(t, d, 0.02) + punchAt(t, eDone, 0.03) + punchAt(t, f, 0.02)}
      >
        <Terminal x={210} y={70} w={1500} h={940} title="demo-shop — claude">
          <div style={{ background: "#1d2027", borderRadius: 8, padding: "10px 16px", color: "#c9ced6", fontSize: 22 }}>&gt; [Pasted message from Greenlight]</div>
          <Step p={ramp(t, a, a + 0.5)} sub={t > aRes ? <div style={{ opacity: ramp(t, aRes, aRes + 0.4) }}><span style={{ color: "#3ad583" }}>✓</span> Cart: passed &nbsp; <span style={{ color: C.red }}>✗</span> Newsletter: failed, Kane saw every sign-up fail</div> : null}>
            Reading Kane's verdict from Greenlight.
          </Step>
          <Step p={ramp(t, b, b + 0.5)}>Looking at the sign-up form.</Step>
          <Step
            p={ramp(t, c, c + 0.5)}
            sub={
              t > diff ? (
                <div style={{ opacity: ramp(t, diff, diff + 0.4), border: "1px solid #343943", borderRadius: 10, overflow: "hidden", fontSize: 23, marginTop: 8, width: 760 }}>
                  <div style={{ padding: "5px 14px", color: "#8b93a1", background: "#1a1d23" }}>app.js</div>
                  <div style={{ padding: "4px 14px", background: "rgba(255,90,69,0.16)", color: "#ffa494", transform: `translateX(${-(1 - ramp(t, diff, diff + 0.4)) * 30}px)` }}>-   if (res.status === "ok") {"{"}</div>
                  <div style={{ padding: "4px 14px", background: "rgba(46,230,138,0.16)", color: "#8ff0bd", transform: `translateX(${(1 - ramp(t, diff + 0.25, diff + 0.65)) * 30}px)`, opacity: ramp(t, diff + 0.25, diff + 0.5) }}>+   if (res.ok) {"{"}</div>
                </div>
              ) : null
            }
          >
            Found it: the form misreads the server's reply, so every sign-up looks like a failure.
          </Step>
          <Step p={ramp(t, d, d + 0.5)}>Fixed. Saving the change and publishing it.</Step>
          <Step p={ramp(t, e, e + 0.5)} done={t > eDone} sub={t > eDone ? <span style={{ opacity: ramp(t, eDone, eDone + 0.3) }}>The new version is live.</span> : null}>
            Waiting for the new version to go live{t > eDone ? "." : "…"}
          </Step>
          <Step p={ramp(t, f, f + 0.5)}>Asking Greenlight to have Kane check again.</Step>
          {t > g ? (
            <div style={{ marginTop: 18, color: ORANGE }}>
              {"✢✳✶✻✽"[Math.floor(t * 8) % 5]} <span style={{ color: "#e6e8eb" }}>Kane is checking again…</span>
            </div>
          ) : null}
        </Terminal>
      </Camera>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 60 }}>
        <Words text="You just watch." t={t} at={g} size={78} hl={{ watch: C.green }} />
      </div>
      <Sfx at={a} name="data" volume={0.3} />
      <Sfx at={aRes} name="pop" volume={0.25} />
      <Sfx at={b} name="data" volume={0.3} />
      <Sfx at={c} name="data" volume={0.3} />
      <Sfx at={diff} name="hit" volume={0.45} />
      <Sfx at={d} name="data" volume={0.3} />
      <Sfx at={e} name="data" volume={0.3} />
      <Sfx at={eDone} name="pop" volume={0.35} />
      <Sfx at={f} name="data" volume={0.3} />
      <Chapter n="09" name="Claude Code fixes it" t={t} />
      <Sweep t={t} at={diff + 0.2} x={300} y={540} w={900} h={200} alpha={0.35} />
    </AbsoluteFill>
  );
}

// ================================================================== 10. Kane checks again

export function Again() {
  const t = useT();
  const tests = say("again", "Kane tests the new version");
  const works = say("again", "This time it works") - 0.4;
  const every = say("again", "Every claim passes");
  const found = say("again", "Kane found the problem");
  const fixed = say("again", "Claude Code fixed it");
  const proved = say("again", "Kane proved the fix");
  const typeAt = tests + 0.4;
  const sub = works - 0.15;
  const email = typed("ada@example.com", t, typeAt, 26);
  const cur = cursorAt(t, [
    [0, 1500, 900],
    [typeAt, 1080, 478],
    [sub, 1520, 478],
  ]);
  const list = t > every - 0.4;
  return (
    <AbsoluteFill>
      <Night t={t} tint="#123a6a" accent="#0f6a3e" />
      {!list ? (
        <Camera shots={[[0, 960, 540, 1], [typeAt - 0.6, 1300, 480, 1.6], [sub + 0.3, 1250, 520, 1.5]]} travel={0.7} shake={shakeAt(t, sub + 0.3, 10)}>
          <Window {...WIN} url={LIVE}>
            <Shop count={0} email={email} msg={t > sub + 0.3 ? "ok" : undefined} />
          </Window>
          <Cursor x={cur[0]} y={cur[1]} down={press(t, sub)} label="Kane CLI" />
          <Click x={cur[0]} y={cur[1]} t={t} at={sub} />
          <Shockwave x={1260} y={560} t={t} at={sub + 0.3} color={C.green} max={900} rings={3} />
          <Burst x={1260} y={560} t={t} at={sub + 0.3} color={C.green} reach={700} />
        </Camera>
      ) : (
        <Camera shots={[[every - 0.4, 960, 540, 1.15], [every, 960, 540, 1], [proved + 1, 960, 540, 1.06]]} travel={0.6} shake={shakeAt(t, every, 20, 0.6)}>
          <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 30 }}>
            <Slam text="Every claim passes." t={t} at={every - 0.05} size={130} color="#fff" glow="rgba(46,230,138,0.6)" />
            <div style={{ width: 980, display: "flex", flexDirection: "column", gap: 16, marginTop: 10 }}>
              <ClaimRow n="01" text="Add items to the cart" status="pass" p={ramp(t, every + 0.3, every + 0.9, BACK)} />
              <ClaimRow n="02" text="Subscribe to the newsletter" status="pass" p={ramp(t, every + 0.45, every + 1.05, BACK)} />
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 20 }}>
              <Tag text="Kane found it" t={t} at={found} color="#fff" ink={C.ink} size={28} />
              <Tag text="Claude Code fixed it" t={t} at={fixed} color={ORANGE} ink="#fff" size={28} />
              <Tag text="Kane proved it" t={t} at={proved} size={28} />
            </div>
          </AbsoluteFill>
          <Shockwave x={960} y={420} t={t} at={every} color={C.green} max={1600} rings={4} />
          <Burst x={960} y={420} t={t} at={every} color={C.green} n={32} reach={1100} />
        </Camera>
      )}
      <Flash t={t} at={every - 0.02} max={0.8} />
      <Typing start={typeAt} text="ada@example.com" cps={26} />
      <Sfx at={sub} name="click" volume={0.5} />
      <Sfx at={sub + 0.3} name="pass" volume={0.5} />
      <Sfx at={every - 0.6} name="riser" volume={0.35} />
      <Sfx at={every} name="boom" volume={0.95} />
      <Sfx at={sub + 0.3} name="hit" volume={0.5} />
      <Sfx at={every + 0.3} name="pop" volume={0.3} />
      <Sfx at={every + 0.45} name="pop" volume={0.3} />
      <Chapter n="10" name="Kane checks again" t={t} />
      <Sfx at={found} name="tick" volume={0.25} />
      <Sfx at={fixed} name="tick" volume={0.25} />
      <Sfx at={proved} name="pass" volume={0.35} />
    </AbsoluteFill>
  );
}

// ================================================================== 11. Close

export function Close() {
  const t = useT();
  const gl = say("close", "Greenlight");
  const checks = say("close", "Kane CLI checks every promise");
  const keeps = say("close", "Claude Code keeps them");
  const tryIt = say("close", "Try it on your app today");
  const end = 18;
  const p = ramp(t, gl - 0.3, gl + 0.3);
  return (
    <AbsoluteFill>
      <Sky t={t + 90} />
      <Camera shots={[[0, 960, 540, 1.04], [8, 960, 540, 1]]} travel={8} shake={shakeAt(t, gl - 0.25, 10)}>
        <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 34 }}>
          <div style={{ transform: `scale(${mix(2, 1, p)})`, filter: `blur(${(1 - p) * 20}px)`, opacity: clamp01(p * 2) }}>
            <Wordmark h={170} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Words text="Kane CLI checks every promise." t={t} at={checks} size={54} weight={700} per={0.05} />
            <Words text="Claude Code keeps them." t={t} at={keeps} size={54} weight={700} per={0.05} hl={{ keeps: "#c4ffdc", them: "#c4ffdc" }} />
          </div>
          <div style={{ display: "flex", gap: 16, opacity: ramp(t, tryIt - 0.2, tryIt + 0.4), transform: `translateY(${(1 - ramp(t, tryIt - 0.2, tryIt + 0.5)) * 30}px)` }}>
            <span style={{ padding: "16px 28px", borderRadius: 999, background: "#fff", color: C.ink, font: `800 28px ${SANS}` }}>Try it on your app today</span>
            <span style={{ padding: "16px 28px", borderRadius: 999, background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.5)", color: "#fff", font: `700 26px ${SANS}` }}>{APP}</span>
          </div>
        </AbsoluteFill>
      </Camera>
      <Shockwave x={960} y={400} t={t} at={gl - 0.25} color="#ffffff" max={1300} />
      <AbsoluteFill style={{ background: "#000", opacity: ramp(t, end - 1.6, end - 0.1, IN) }} />
      <Sfx at={gl - 0.3} name="boom" volume={0.8} />
      <Sfx at={tryIt - 0.2} name="pop" volume={0.35} />
    </AbsoluteFill>
  );
}
