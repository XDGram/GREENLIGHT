import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import "../fonts";
import "./fonts";
import { clamp01, mix, PreCtx, ramp } from "../lib";
import { FPS, LINES, say, SCENES, sceneStart, TOTAL } from "../timeline";
import { Again, Brand, Claims, Close, Fix, Install, Kane, Paste, Promise, Start, Verdict } from "./scenes";

const COMPONENTS: Record<string, React.FC> = { promise: Promise, brand: Brand, start: Start, claims: Claims, kane: Kane, verdict: Verdict, install: Install, paste: Paste, fix: Fix, again: Again, close: Close };
/** Seconds each scene blurs in over the end of the one before. */
const PRE: Record<string, number> = { brand: 0.4, start: 0.5 };

const VO = SCENES.map((s, i) => {
  const a = sceneStart(s.key) + s.voAt;
  return { a: a + LINES[i].sentences[0].start, b: a + LINES[i].duration, file: `vo/${String(i + 1).padStart(2, "0")}.mp3`, at: a };
});

// Music: "Inspired" (Kevin MacLeod, CC BY 4.0). Dips under the voice; drops out when the claim
// fails, comes back muffled while it is broken, opens up during the fix, fuller once Kane passes.
const FAIL = sceneStart("kane") + say("kane", "But the newsletter") + 0.45;
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
  let v = 0.4;
  v = mix(v, 0.5, 1 - ramp(t, 20, 26));
  v = mix(v, 0.56, ramp(t, PASS - 0.2, PASS + 1.2));
  const drop = ramp(t, FAIL - 0.05, FAIL + 0.25) * (1 - ramp(t, FAIL + 2.2, FAIL + 4));
  v *= 1 - 0.85 * drop;
  v *= 1 - ramp(t, TOTAL - 2.5, TOTAL - 0.2);
  return v;
}
const muffle = (t: number) => ramp(t, FAIL + 1.6, FAIL + 2.2) * (1 - ramp(t, CLEAR, CLEAR + 4));
const level = (t: number) => base(t) * (1 - 0.7 * voCover(t));

function SceneIn({ pre, children }: { pre: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const p = pre > 0 ? clamp01(f / (pre * FPS)) : 1;
  return <AbsoluteFill style={{ opacity: p, filter: p < 1 ? `blur(${(1 - p) * 16}px)` : undefined }}>{children}</AbsoluteFill>;
}

export const Launch: React.FC = () => (
  <AbsoluteFill style={{ background: "#fff" }}>
    {SCENES.map((s) => {
      const Comp = COMPONENTS[s.key];
      const pre = PRE[s.key] ?? 0;
      return (
        <Sequence key={s.key} from={Math.round((sceneStart(s.key) - pre) * FPS)} durationInFrames={Math.round((s.dur + pre) * FPS)} name={s.key}>
          <SceneIn pre={pre}>
            <PreCtx.Provider value={pre}>
              <Comp />
            </PreCtx.Provider>
          </SceneIn>
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

export const LAUNCH_FRAMES = Math.round(TOTAL * FPS);
