import vo from "./data/vo.json";

export const FPS = 30;
export const W = 1920;
export const H = 1080;

/** Scenes in order: length in seconds, when its voiceover line starts, and how long it fades in over the scene before. */
export const SCENES = [
  { key: "promise", dur: 11, voAt: 1.0, pre: 0 },
  { key: "brand", dur: 13, voAt: 2.6, pre: 0 },
  { key: "start", dur: 12, voAt: 1.0, pre: 0.6 },
  { key: "claims", dur: 14, voAt: 0.8, pre: 0 },
  { key: "kane", dur: 26, voAt: 1.2, pre: 0 },
  { key: "verdict", dur: 19, voAt: 1.6, pre: 0 },
  { key: "install", dur: 13, voAt: 0.8, pre: 0 },
  { key: "paste", dur: 13, voAt: 0.8, pre: 0 },
  { key: "fix", dur: 27, voAt: 1.2, pre: 0 },
  { key: "again", dur: 20, voAt: 3.0, pre: 0 },
  { key: "close", dur: 18, voAt: 2.0, pre: 0 },
] as const;

export type SceneKey = (typeof SCENES)[number]["key"];

export const sceneIndex = (k: SceneKey) => SCENES.findIndex((s) => s.key === k);
export const sceneStart = (k: SceneKey) => SCENES.slice(0, sceneIndex(k)).reduce((a, s) => a + s.dur, 0);
export const TOTAL = SCENES.reduce((a, s) => a + s.dur, 0);
export const MUSIC_START: number = vo.musicStart;

type Sentence = { text: string; start: number; end: number };
export const LINES: { text: string; duration: number; sentences: Sentence[] }[] = vo.lines;

/** Seconds from the scene's start at which `phrase` is spoken in the scene's line (by sentence timing, then character share). */
export function say(k: SceneKey, phrase: string, after = false): number {
  const i = sceneIndex(k);
  const line = LINES[i];
  const base = SCENES[i].voAt;
  for (const s of line.sentences) {
    const at = s.text.indexOf(phrase);
    if (at >= 0) {
      const share = (at + (after ? phrase.length : 0)) / s.text.length;
      // A sentence's audio starts a little after the pause ends and finishes before the next one.
      const a = s.start + 0.05;
      const b = s.end - 0.25;
      return base + a + (b - a) * share;
    }
  }
  throw new Error(`phrase not found in ${k}: ${phrase}`);
}

/** When the scene's line ends (seconds from scene start). */
export const voEnd = (k: SceneKey) => SCENES[sceneIndex(k)].voAt + LINES[sceneIndex(k)].duration;
