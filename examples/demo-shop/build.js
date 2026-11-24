// Vercel build step: publish the deployed commit at /greenlight.json so Greenlight (and the coding
// agent waiting for its fix to go live) know exactly which commit Kane is testing.
import fs from "node:fs";
fs.mkdirSync("dist", { recursive: true });
for (const f of ["index.html", "app.js"]) fs.copyFileSync(f, `dist/${f}`);
fs.writeFileSync("dist/greenlight.json", JSON.stringify({ commit: process.env.VERCEL_GIT_COMMIT_SHA || null, environment: process.env.VERCEL_ENV || null }) + "\n");
