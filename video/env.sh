# source video/env.sh before running HyperFrames: local Chromium, no telemetry, no skill installs.
export HYPERFRAMES_BROWSER_PATH="${HYPERFRAMES_BROWSER_PATH:-/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell}"
export HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_SKIP_SKILLS=1
