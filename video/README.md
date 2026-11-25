# Greenlight demo video

**The launch film:** `release/greenlight-launch.mp4` (1920 × 1080, 30 fps, 3:06), composition `Launch` in `remotion/src/launch/`.

- White stage; the product is the real Greenlight app and the real demo shop, captured at 2× by
  `capture/capture-app.cjs` and `capture/capture-shop.cjs` (with the box of every element the pointer clicks).
- Kinetic type (Inter), cards, Screen Studio style camera that zooms to each click with motion blur.
- Closing card made with HyperFrames (`hyperframes/outro`, from the logo-outro and blur-in recipes), rendered to `public/hf/outro.mp4`.
- Sound: Kenney Interface Sounds (CC0, `public/sfx/kenney`), voice by Bella (ai33pro), music "Inspired" by Kevin MacLeod (CC BY 4.0).
- Demo shop elements from Uiverse.io (MIT): the add-to-cart button by vinodjangid07 and the subscribe card by satyamchaudharydev.

Rebuild: start the local preview server, run the two capture scripts, `python3 prep.py 186`, render HyperFrames outro, then
`npx remotion render Launch out/launch.mp4 --crf=18`.

**The film:** `release/greenlight-demo.mp4` (1920 × 1080, 30 fps, 3:06). Script and rules: `SCRIPT.md`, `BRIEF.md`.

Rebuild it:

```bash
cd video && npm install
python3 prep.py 186        # voice timings, interface sounds, music stems (from music/Inspired.mp3)
npx remotion render Demo out/greenlight-demo.mp4 --crf=18
```

- `remotion/src/scenes.tsx`: the 11 shots. Every action is timed to the spoken words (`say()` in `timeline.ts`, from the pauses measured in each voice file).
- `remotion/src/ui.tsx`: the rebuilt interface (sky, nav, logo, result page, demo shop, Kane board, Claude Code terminal).
- Cuts are match cuts on a shared element, and land on the music's beat grid (HyperFrames `beats`: 120 BPM).
- Music: "Inspired" by Kevin MacLeod (incompetech.com), CC BY 4.0. Credit it in the YouTube description.

Tools for the hackathon demo video. This folder has its own `package.json` and is not part of the app build.

- **Remotion 4.0.547** (React compositions): `remotion/src/`
- **HyperFrames 0.9.91** (HTML compositions): create projects in this folder

```bash
cd video && npm install

# Remotion
npx remotion studio                                 # preview in the browser
npx remotion render <CompositionId> out/demo.mp4    # render

# HyperFrames
source env.sh                                       # local Chromium, telemetry off
npx hyperframes init scenes --example blank --non-interactive --skip-skills
cd scenes && npx hyperframes render -o ../out/scenes.mp4
```

Both use the Chromium already installed at `/opt/pw-browsers` (set in `remotion.config.ts` and `env.sh`). On another machine, set `REMOTION_BROWSER` and `HYPERFRAMES_BROWSER_PATH`, or unset them to let each tool download its own browser. Rendered files go to `out/`, which is not committed.

## Voiceover (ai33pro text to speech)

```bash
bash tts.sh "Your line" out/line.mp3          # default voice: Bella
VOICE=<voice_id> SPEED=1.1 bash tts.sh "..." out/line.mp3
```

The API key is not in this repository. In the cloud session the network proxy adds it to requests to `api.ai33.pro`; anywhere else, set `AI33_KEY`. Generate lines one at a time (the API rate-limits), and don't regenerate needlessly: it costs about 1 credit per character.
