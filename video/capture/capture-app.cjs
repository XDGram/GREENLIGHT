// Captures the real Greenlight app, state by state, at 2x, with the boxes of everything the film clicks.
// Runs against the local preview server (fake backend); the demo-shop check data is served by route
// interception so the real UI renders the Demo Shop story.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const OUT = process.argv[2];
const INFO = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const README = process.argv[4];
const WD = JSON.parse(fs.readFileSync("/tmp/wd-detail.json", "utf8"));
const WR = JSON.parse(fs.readFileSync("/tmp/wd-run.json", "utf8"));
fs.mkdirSync(OUT, { recursive: true });
const PID = "prj_" + "d".repeat(32);
const REC = "vr_" + "e".repeat(32);
const CLAIMS = ["Users can add items to the cart and the cart count goes up", "Users can subscribe to the newsletter with their email and see a confirmation"];
const NOTE = "Three valid email submissions all returned “Subscription failed. Please try again later.” and no confirmation appeared.";
let mode = "running";
const now = () => new Date().toISOString();
const started = new Date(Date.now() - 64000).toISOString();

function detail() {
  const d = JSON.parse(JSON.stringify(WD));
  d.project = { ...d.project, id: PID, name: "Demo Shop", url: "https://greenlight-demo-shop.vercel.app/" };
  d.details = { ...(d.details || {}), description: "A small test store.", repository: "https://github.com/XDGram/GREENLIGHT", purpose: "Cart and newsletter." };
  const v = d.versions[d.versions.length - 1];
  v.claims = CLAIMS.map((t, i) => ({ id: `CLM-00${i + 1}`, text: t }));
  const job = { ...d.jobs[0], id: "job_" + "f".repeat(32), projectId: PID, status: mode === "running" ? "running" : "succeeded", outcome: mode === "running" ? null : `not_certified:${mode}`, startedAt: started, createdAt: started, finishedAt: mode === "running" ? null : now(), recordId: mode === "running" ? null : REC, version: v.version };
  d.jobs = [job];
  d.records = mode === "running" ? [] : [{ ...(d.records[0] || {}), id: REC, status: mode }];
  return d;
}
function run() {
  const r = JSON.parse(JSON.stringify(WR));
  const st = [mode === "failed" ? "passed" : "passed", mode === "failed" ? "failed" : "passed"];
  r.record = { ...r.record, id: REC, status: mode, deployment: { ...r.record.deployment, url: "https://greenlight-demo-shop.vercel.app/" }, claims: CLAIMS.map((t, i) => ({ id: `CLM-00${i + 1}`, text: t, status: st[i] })), startedAt: started, endedAt: now(), credits: { actual: 77, estimate: 94 } };
  r.claims = CLAIMS.map((t, i) => ({ id: `CLM-00${i + 1}`, text: t, status: st[i], tests: [{ file: `t${i}_test.md`, status: st[i] === "passed" ? "passed" : "app_failure" }] }));
  r.tests = CLAIMS.map((t, i) => ({ file: `t${i}_test.md`, title: i ? "Newsletter" : "Cart", claims: [`CLM-00${i + 1}`], status: st[i] === "passed" ? "passed" : "app_failure", reasons: [], durationS: 40, failureMessage: st[i] === "passed" ? null : NOTE, failedStep: st[i] === "passed" ? null : { index: 3, name: "Check", kind: "expect_text", text: "A confirmation appears." }, steps: [] }));
  r.execution = { ...r.execution, kane: { ...r.execution.kane, exitCode: mode === "passed" ? 0 : 1 } };
  return r;
}

const cookieOf = (c) => { const [name, ...v] = c.split("="); return { name, value: v.join("="), domain: "localhost", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }; };
const boxes = {};
async function box(p, state, name, loc) {
  const b = await loc.first().boundingBox();
  if (!b) throw new Error(`no box for ${state}.${name}`);
  const s = await p.evaluate(() => window.scrollY);
  boxes[state] = boxes[state] || {};
  boxes[state][name] = { x: b.x, y: b.y + s, w: b.width, h: b.height };
}
async function shot(p, name, full = true) {
  await p.mouse.move(-10, -10);
  await p.waitForTimeout(250);
  await p.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 92, fullPage: full });
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  boxes[name] = boxes[name] || {};
  boxes[name]._page = { w: 1440, h: full ? h : 900 };
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addCookies([cookieOf(INFO.userCookie)]);
  const p = await ctx.newPage();
  await p.route("**/app/api/checks", (r) => (r.request().method() === "POST" ? r.fulfill({ json: { projectId: PID, job: detail().jobs[0], estimate: 94 } }) : r.continue()));
  await p.route(`**/app/api/projects/${PID}`, (r) => r.fulfill({ json: detail() }));
  await p.route(`**/app/api/projects/${PID}/records/${REC}`, (r) => r.fulfill({ json: run() }));
  await p.route("**/app/api/tokens", (r) => (r.request().method() === "POST" ? r.fulfill({ json: { id: "a".repeat(16), role: "agent", label: "Claude Code", token: "gl_7Qm2xVd9KpL4tN8wRz3bYc6HsJ1fGe", note: "" } }) : r.continue()));

  // New check
  await p.goto(INFO.url + "/app/new", { waitUntil: "networkidle" });
  await p.addStyleTag({ content: "*{caret-color:transparent !important} .cloud{animation:none !important}" });
  const repo = p.getByPlaceholder("https://github.com/you/your-app");
  const url = p.getByPlaceholder("https://your-app.vercel.app");
  await shot(p, "new-empty");
  for (const [n, l] of [["repo", repo], ["url", url], ["notes", p.locator("textarea")], ["upload", p.getByRole("button", { name: "Upload README" })], ["check", p.getByRole("button", { name: "Check my app" })]]) await box(p, "new-empty", n, l);
  const R = "https://github.com/XDGram/GREENLIGHT", U = "https://greenlight-demo-shop.vercel.app";
  const steps = (s) => { const out = []; for (let i = 4; i < s.length; i += 4) out.push(i); out.push(s.length); return out; };
  for (const i of steps(R)) { await repo.fill(R.slice(0, i)); await repo.focus(); await shot(p, `new-repo-${String(i).padStart(2, "0")}`, false); }
  for (const i of steps(U)) { await url.fill(U.slice(0, i)); await url.focus(); await shot(p, `new-url-${String(i).padStart(2, "0")}`, false); }
  await p.locator('input[type="file"]').setInputFiles(README);
  await p.waitForTimeout(300);
  await shot(p, "new-loaded");
  await box(p, "new-loaded", "check", p.getByRole("button", { name: "Check my app" }));
  await p.getByRole("button", { name: "Check my app" }).click();
  await p.getByText("Step 2").waitFor();
  await p.waitForTimeout(500);
  await shot(p, "claims");
  for (const [n, l] of [["switch1", p.locator(".uv-switch").nth(0)], ["switch2", p.locator(".uv-switch").nth(1)], ["row1", p.locator(".claim-row").nth(0)], ["row2", p.locator(".claim-row").nth(1)], ["confirm", p.locator(".confirm-box")], ["run", p.locator("button.btn.green")], ["step2", p.getByText("Step 2")]]) await box(p, "claims", n, l);
  await p.locator(".uv-switch input").nth(1).click({ force: true });
  await p.waitForTimeout(400);
  await shot(p, "claims-off");
  await p.locator(".uv-switch input").nth(1).click({ force: true });
  await p.waitForTimeout(400);

  // Run: live view
  await p.locator("button.btn.green").click();
  await p.waitForURL(/\/app\/check\//);
  await p.locator(".kl").waitFor();
  await p.waitForTimeout(600);
  for (let i = 0; i < 18; i++) { await p.screenshot({ path: path.join(OUT, `running-${String(i).padStart(2, "0")}.jpg`), type: "jpeg", quality: 90 }); await p.waitForTimeout(170); }
  boxes.running = { _page: { w: 1440, h: 900 } };
  await box(p, "running", "board", p.locator(".kl-board"));
  await box(p, "running", "stages", p.locator(".kl-stages"));
  await box(p, "running", "claims", p.locator(".kl-claims"));
  // The live board at 30 fps: seek the page's own CSS animations frame by frame (one 3 s cycle).
  fs.mkdirSync(path.join(OUT, "board"), { recursive: true });
  const bb = await p.locator(".kl-board").boundingBox();
  for (let i = 0; i < 90; i++) {
    await p.evaluate((ms) => document.getAnimations().forEach((a) => { if (a.effect.getTiming().iterations === Infinity) { a.pause(); a.currentTime = ms; } else a.finish(); }), i * (1000 / 30));
    await p.screenshot({ path: path.join(OUT, "board", `b${String(i).padStart(2, "0")}.jpg`), type: "jpeg", quality: 90, clip: bb });
  }
  await p.evaluate(() => document.getAnimations().forEach((a) => a.play()));

  // Failed verdict
  mode = "failed";
  await p.reload({ waitUntil: "networkidle" });
  await p.getByText("What Kane saw").waitFor();
  await p.addStyleTag({ content: ".cloud{animation:none !important}" });
  await shot(p, "failed");
  for (const [n, l] of [["verdict", p.locator(".pcard").first()], ["note", p.getByText("What Kane saw").locator("..")], ["fixcard", p.locator(".cc-card")], ["connect", p.getByRole("button", { name: /Connect Claude Code/ })], ["install", p.locator(".cc-details summary")], ["claimFail", p.getByText(CLAIMS[1]).first()], ["claimPass", p.getByText(CLAIMS[0]).first()]]) await box(p, "failed", n, l);
  await p.locator(".cc-details summary").click();
  await p.waitForTimeout(300);
  await shot(p, "failed-install");
  const instCopy = p.locator(".cc-details").getByRole("button", { name: /Copy/ }).last();
  await box(p, "failed-install", "copy", instCopy);
  await box(p, "failed-install", "code", p.locator(".cc-details pre").last());
  await instCopy.click().catch(() => {});
  await p.waitForTimeout(250);
  await shot(p, "failed-install-copied");
  await p.getByRole("button", { name: /Connect Claude Code/ }).click();
  await p.locator(".cc-code").first().waitFor();
  await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelectorAll(".cc-code").forEach((e) => { e.textContent = e.textContent.replaceAll("http://localhost:4321", "https://greenlight-api-xi.vercel.app").replace(/gl_[A-Za-z0-9]+/, "gl_" + "\u2022".repeat(24)); }));
  await shot(p, "failed-connect");
  const msgCopy = p.locator(".cc-copyrow").first().getByRole("button");
  await box(p, "failed-connect", "copy", msgCopy);
  await box(p, "failed-connect", "message", p.locator(".cc-code").first());
  await msgCopy.click().catch(() => {});
  await p.waitForTimeout(250);
  await shot(p, "failed-connect-copied");

  // Passed verdict
  mode = "passed";
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  await p.addStyleTag({ content: ".cloud{animation:none !important}" });
  await shot(p, "passed");
  await box(p, "passed", "verdict", p.locator(".pcard").first());
  await box(p, "passed", "claims", p.getByText(CLAIMS[1]).first());

  fs.writeFileSync(path.join(OUT, "boxes.json"), JSON.stringify(boxes, null, 1));
  await b.close();
  console.log("captured", Object.keys(boxes).length, "states");
})().catch((e) => { console.error(e); process.exit(1); });
