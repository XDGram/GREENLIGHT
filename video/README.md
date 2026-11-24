# Greenlight demo video

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
