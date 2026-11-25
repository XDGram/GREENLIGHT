import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import "./fonts";
import { clamp01, mix, ramp, Shell, type In, type Out } from "./film/kit";
import { Again, Brand, Claims, Close, Fix, Install, Kane, Paste, Promise, Start, Verdict } from "./film/scenes";
import { FPS, LINES, say, SCENES, sceneStart, TOTAL } from "./timeline";

// The Greenlight film: the same voiceover and music as before, every picture rebuilt as motion.
// No captions: the words that matter are set as kinetic type inside the shots.

const PLAN: Record<string, { comp: React.FC; pre: number; enter: In; exit: Out }> = {
  promise: { comp: Promise, pre: 0, enter: { kind: "cut" }, exit: { kind: "hold" } },
  brand: { comp: Brand, pre: 0.7, enter: { kind: "burst", x: 960, y: 540 }, exit: { kind: "through", x: 960, y: 470 } },
  start: { comp: Start, pre: 0.6, enter: { kind: "zoom" }, exit: { kind: "whip" } },
  claims: { comp: Claims, pre: 0.55, enter: { kind: "whip" }, exit: { kind: "hold" } },
  kane: { comp: Kane, pre: 0.55, enter: { kind: "burst", x: 960, y: 540 }, exit: { kind: "whip" } },
  verdict: { comp: Verdict, pre: 0.6, enter: { kind: "whip" }, exit: { kind: "through", x: 1420, y: 560 } },
  install: { comp: Install, pre: 0.55, enter: { kind: "zoom" }, exit: { kind: "whip" } },
  paste: { comp: Paste, pre: 0.55, enter: { kind: "whip" }, exit: { kind: "through", x: 1410, y: 550 } },
  fix: { comp: Fix, pre: 0.6, enter: { kind: "zoom" }, exit: { kind: "drop" } },
  again: { comp: Again, pre: 0.55, enter: { kind: "rise" }, exit: { kind: "hold" } },
  close: { comp: Close, pre: 0.7, enter: { kind: "burst", x: 960, y: 420 }, exit: { kind: "hold" } },
};

const VO = SCENES.map((s, i) => {
  const a = sceneStart(s.key) + s.voAt;
  return { a: a + LINES[i].sentences[0].start, b: a + LINES[i].duration, file: `vo/${String(i + 1).padStart(2, "0")}.mp3`, at: a };
});

// Music: dips under the voice, drops out when the claim fails, comes back muffled while it is
// broken, opens up during the fix, fuller once Kane passes.
const FAIL = sceneStart("kane") + say("kane", "But the newsletter") + 0.5;
const CLEAR = sceneStart("paste");
const PASS = sceneStart("again") + say("again", "Every claim passes");
function voCover(t: number) {
  let c = 0;
  for (const v of VO) {
    if (t < v.a - 0.3 || t > v.b + 0.7) continue;
    c = Math.max(c, Math.min(clamp01((t - (v.a - 0.3)) / 0.3), clamp01((v.b + 0.7 - t) / 0.7)));
  }
  return c;
}
function base(t: number) {
  let v = 0.45;
  v = mix(v, 0.52, 1 - ramp(t, 20, 26));
  v = mix(v, 0.62, ramp(t, PASS - 0.2, PASS + 1.2));
  const drop = ramp(t, FAIL - 0.05, FAIL + 0.25) * (1 - ramp(t, FAIL + 2.2, FAIL + 4));
  v *= 1 - 0.85 * drop;
  v *= 1 - ramp(t, TOTAL - 2.5, TOTAL - 0.2);
  return v;
}
const muffle = (t: number) => ramp(t, FAIL + 1.6, FAIL + 2.2) * (1 - ramp(t, CLEAR, CLEAR + 4));
const level = (t: number) => base(t) * (1 - 0.68 * voCover(t));

export const Film: React.FC = () => (
  <AbsoluteFill style={{ background: "#05070d" }}>
    {SCENES.map((s, i) => {
      const plan = PLAN[s.key];
      const next = SCENES[i + 1] ? PLAN[SCENES[i + 1].key] : null;
      const from = Math.round((sceneStart(s.key) - plan.pre) * FPS);
      const dur = Math.round((s.dur + plan.pre) * FPS);
      const Comp = plan.comp;
      return (
        <Sequence key={s.key} from={from} durationInFrames={dur} name={s.key}>
          <Shell enter={plan.enter} exit={plan.exit} pre={plan.pre} dur={s.dur} nextPre={next && plan.exit.kind !== "hold" ? next.pre : 0}>
            <Comp />
          </Shell>
        </Sequence>
      );
    })}
    {VO.map((v) => (
      <Sequence key={v.file} from={Math.round(v.at * FPS)} layout="none">
        <Audio src={staticFile(v.file)} volume={1} />
      </Sequence>
    ))}
    <Audio src={staticFile("music/full.wav")} volume={(f) => level(f / FPS) * (1 - muffle(f / FPS))} />
    <Audio src={staticFile("music/muffled.wav")} volume={(f) => level(f / FPS) * muffle(f / FPS)} />
  </AbsoluteFill>
);

export const FILM_FRAMES = Math.round(TOTAL * FPS);
