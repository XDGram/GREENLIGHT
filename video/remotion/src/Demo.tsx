import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import "./fonts";
import { clamp01, mix, PreCtx, ramp } from "./lib";
import { Again, Brand, Claims, Close, Fix, Install, Kane, Paste, Promise, Start, Verdict } from "./scenes";
import { FPS, LINES, say, SCENES, sceneStart, TOTAL } from "./timeline";
import { SANS } from "./ui";

const COMPONENTS: Record<string, React.FC> = { promise: Promise, brand: Brand, start: Start, claims: Claims, kane: Kane, verdict: Verdict, install: Install, paste: Paste, fix: Fix, again: Again, close: Close };

/** Voiceover intervals in film seconds. */
const VO = SCENES.map((s, i) => {
  const a = sceneStart(s.key) + s.voAt;
  return { a: a + LINES[i].sentences[0].start, b: a + LINES[i].duration, file: `vo/${String(i + 1).padStart(2, "0")}.mp3`, at: a };
});

/** Captions: each sentence, long ones split at a comma or colon near the middle. */
type Cap = { text: string; a: number; b: number };
const CAPS: Cap[] = [];
SCENES.forEach((s, i) => {
  const base = sceneStart(s.key) + s.voAt;
  const ss = LINES[i].sentences;
  ss.forEach((se, j) => {
    const a = base + se.start;
    const b = base + (j + 1 < ss.length ? ss[j + 1].start : LINES[i].duration);
    const text = se.text;
    if (text.length <= 62) {
      CAPS.push({ text, a, b });
      return;
    }
    const mid = text.length / 2;
    let cut = -1;
    for (const m of text.matchAll(/[,:] /g)) if (cut < 0 || Math.abs(m.index! - mid) < Math.abs(cut - mid)) cut = m.index!;
    if (cut < 0) {
      cut = text.indexOf(" ", Math.floor(mid));
    } else cut += 1;
    const first = text.slice(0, cut).trim();
    const second = text.slice(cut).trim();
    const split = a + (b - a) * (first.length / text.length);
    CAPS.push({ text: first, a, b: split });
    CAPS.push({ text: second, a: split, b });
  });
});

function Captions() {
  const t = useCurrentFrame() / FPS;
  const c = CAPS.find((x) => t >= x.a - 0.05 && t < x.b);
  if (!c) return null;
  const o = Math.min(clamp01((t - (c.a - 0.05)) / 0.12), clamp01((c.b - t) / 0.12));
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, display: "flex", justifyContent: "center", zIndex: 100 }}>
      <div style={{ maxWidth: 1400, padding: "12px 26px", borderRadius: 14, background: "rgba(14,19,26,0.82)", color: "#fff", font: `500 31px/1.3 ${SANS}`, textAlign: "center", opacity: o }}>{c.text}</div>
    </div>
  );
}

// Music: "Inspired" (Kevin MacLeod, CC BY 4.0). Dips under the voice; drops out when the claim
// fails, comes back muffled while it is broken, opens up during the fix, fuller once Kane passes.
const FAIL = sceneStart("kane") + say("kane", "But the newsletter") + 0.5;
const CLEAR = sceneStart("paste");
const PASS = sceneStart("again") + say("again", "Every claim passes");

function voCover(t: number) {
  let c = 0;
  for (const v of VO) {
    if (t < v.a - 0.3 || t > v.b + 0.7) continue;
    const up = clamp01((t - (v.a - 0.3)) / 0.3);
    const down = clamp01((v.b + 0.7 - t) / 0.7);
    c = Math.max(c, Math.min(up, down));
  }
  return c;
}
function base(t: number) {
  let v = 0.42;
  v = mix(v, 0.5, 1 - ramp(t, 20, 26)); // a touch more presence in the opening
  v = mix(v, 0.58, ramp(t, PASS - 0.2, PASS + 1.2)); // fuller after the pass
  const drop = ramp(t, FAIL - 0.05, FAIL + 0.25) * (1 - ramp(t, FAIL + 2.2, FAIL + 4));
  v *= 1 - 0.85 * drop;
  v *= 1 - ramp(t, TOTAL - 2.5, TOTAL - 0.2); // the song's own ending, then out
  return v;
}
const muffle = (t: number) => ramp(t, FAIL + 1.6, FAIL + 2.2) * (1 - ramp(t, CLEAR, CLEAR + 4));
const level = (t: number) => base(t) * (1 - 0.7 * voCover(t));

export const Demo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      {SCENES.map((s) => {
        const Comp = COMPONENTS[s.key];
        const from = Math.round((sceneStart(s.key) - s.pre) * FPS);
        const dur = Math.round((s.dur + s.pre) * FPS);
        return (
          <Sequence key={s.key} from={from} durationInFrames={dur} name={s.key}>
            <SceneFade pre={s.pre}>
              <PreCtx.Provider value={s.pre}>
                <Comp />
              </PreCtx.Provider>
            </SceneFade>
          </Sequence>
        );
      })}
      <Captions />
      {VO.map((v) => (
        <Sequence key={v.file} from={Math.round(v.at * FPS)} layout="none">
          <Audio src={staticFile(v.file)} volume={1} />
        </Sequence>
      ))}
      <Audio src={staticFile("music/full.wav")} volume={(f) => level(f / FPS) * (1 - muffle(f / FPS))} />
      <Audio src={staticFile("music/muffled.wav")} volume={(f) => level(f / FPS) * muffle(f / FPS)} />
    </AbsoluteFill>
  );
};

function SceneFade({ pre, children }: { pre: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const o = pre > 0 ? clamp01(f / (pre * FPS)) : 1;
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
}

export const DEMO_FRAMES = Math.round(TOTAL * FPS);
