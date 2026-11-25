// Captures the real demo shop (examples/demo-shop) state by state at 2x, with element boxes.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const boxes = {};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await p.goto("file://" + path.resolve(__dirname, "../../examples/demo-shop/index.html"));
  await p.addStyleTag({ content: "*{caret-color:transparent !important}" });
  const shot = (n) => p.screenshot({ path: path.join(OUT, n + ".jpg"), type: "jpeg", quality: 92 });
  const box = async (n, sel) => { const r = await p.locator(sel).first().boundingBox(); boxes[n] = { x: r.x, y: r.y, w: r.width, h: r.height }; };
  for (const [n, s] of [["add", "#add-item"], ["badge", "#cart-count"], ["cartlink", ".cart-link"], ["email", "#email"], ["subscribe", "#subscribe"], ["result", "#subscribe-result"], ["news", ".card"], ["product1", ".product"]]) await box(n, s);
  await p.mouse.move(5, 5);
  await shot("shop");
  await p.hover("#add-item");
  for (let i = 0; i <= 12; i++) {
    await p.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; }), i * 100);
    await shot(`shop-hover-${String(i).padStart(2, "0")}`);
  }
  await p.evaluate(() => document.getElementById("add-item").click());
  await p.evaluate(() => document.getElementById("cart-count").classList.add("bump"));
  await p.waitForTimeout(300);
  await shot("shop-count1-bump");
  await p.evaluate(() => document.getElementById("cart-count").classList.remove("bump"));
  await p.waitForTimeout(300);
  await shot("shop-count1");
  await p.mouse.move(5, 5);
  await p.evaluate(() => document.getAnimations().forEach((a) => a.cancel()));
  await shot("shop-count1-rest");
  const E = "ada@example.com";
  for (let i = 1; i <= E.length; i++) { await p.fill("#email", E.slice(0, i)); if (i % 3 === 0 || i === E.length) await shot(`shop-email-${String(i).padStart(2, "0")}`); }
  await p.click("#subscribe");
  await p.waitForTimeout(250);
  await shot("shop-failed");
  await p.evaluate(() => { const o = document.getElementById("subscribe-result"); o.className = "ok"; o.textContent = "Thanks for subscribing, ada@example.com!"; });
  await shot("shop-ok");
  fs.writeFileSync(path.join(OUT, "boxes.json"), JSON.stringify(boxes, null, 1));
  await b.close();
  console.log("shop captured");
})().catch((e) => { console.error(e); process.exit(1); });
