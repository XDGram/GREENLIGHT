import { Config } from "@remotion/cli/config";

// Use the Chromium already on this machine (set REMOTION_BROWSER to override).
Config.setBrowserExecutable(process.env.REMOTION_BROWSER || "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell");
Config.setVideoImageFormat("jpeg");
Config.setEntryPoint("remotion/src/index.ts");
