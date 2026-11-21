// After `vite build`: publish the Claude Code Skill files under /app/downloads/greenlight/ so the
// web app's Integrations page can offer them. Plain copies of skills/greenlight (no secrets).
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../skills/greenlight", import.meta.url));
const to = fileURLToPath(new URL("../public/app/downloads/greenlight", import.meta.url));
await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
process.stdout.write("copied skills/greenlight -> public/app/downloads/greenlight\n");
