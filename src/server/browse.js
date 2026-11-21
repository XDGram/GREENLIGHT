// Reading the live app in a real headless browser (no Kane, no credits): what a visitor sees after
// JavaScript runs. Used to understand the app before tests are proposed; never as a test result.
//
// Safety: only public http(s) addresses. Every request the page makes (redirects, scripts, XHR) is
// checked against private and local addresses and aborted if it targets one; the start address is
// also DNS-checked. Only same-origin pages are visited, at most a few, within a time budget.
// Media and fonts are not downloaded.
//
// Production (Vercel Functions) uses @sparticuz/chromium; GREENLIGHT_CHROMIUM_PATH selects another
// Chromium (local development); tests inject `launch`.

import { requirePublicHost, isLocalOrPrivateHost } from "../deploy/host.js";

const TEXT_LIMIT = 6000;

async function defaultLaunch() {
  const { chromium } = await import("playwright-core");
  if (process.env.GREENLIGHT_CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.GREENLIGHT_CHROMIUM_PATH, headless: true });
  const sparticuz = (await import("@sparticuz/chromium")).default;
  return chromium.launch({ executablePath: await sparticuz.executablePath(), args: sparticuz.args, headless: true });
}

async function readPage(page, url, { timeoutMs }) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForLoadState("networkidle", { timeout: Math.min(5000, timeoutMs) }).catch(() => {});
  const info = await page.evaluate((limit) => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    const clean = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
    const labelOf = (i) => clean((i.labels && i.labels[0] && i.labels[0].innerText) || i.getAttribute("aria-label") || i.placeholder || i.name || "");
    return {
      title: document.title,
      text: clean(document.body ? document.body.innerText : "").slice(0, limit),
      headings: [...document.querySelectorAll("h1,h2,h3")].filter(vis).map((h) => clean(h.innerText)).filter(Boolean).slice(0, 30),
      links: [...document.querySelectorAll("a[href]")].filter(vis).map((a) => ({ text: clean(a.innerText).slice(0, 80), href: a.href })).filter((l) => l.text).slice(0, 60),
      buttons: [...document.querySelectorAll("button,[role=button],input[type=submit]")].filter(vis).map((b) => clean(b.innerText || b.value || b.getAttribute("aria-label"))).filter(Boolean).slice(0, 40),
      forms: [...document.querySelectorAll("form")].slice(0, 10).map((f) => ({
        fields: [...f.querySelectorAll("input,textarea,select")].filter((i) => i.type !== "hidden").slice(0, 12).map((i) => ({ type: i.type || i.tagName.toLowerCase(), label: labelOf(i) })),
      })),
      inputs: [...document.querySelectorAll("input,textarea,select")].filter((i) => i.type !== "hidden" && vis(i)).slice(0, 20).map((i) => ({ type: i.type || i.tagName.toLowerCase(), label: labelOf(i) })),
    };
  }, TEXT_LIMIT);
  return { url: page.url(), status: res?.status() ?? null, ...info };
}

/**
 * @returns {Promise<{status: "ok"|"unavailable", pages?: object[], screenshot?: string, reason?: string, checkedAt: string}>}
 */
export async function readLiveApp({ url, launch = defaultLaunch, checkHost = (h) => requirePublicHost(h), isBlocked = isLocalOrPrivateHost, now = () => new Date(), maxPages = 3, timeoutMs = 12_000, budgetMs = 30_000 }) {
  const checkedAt = now().toISOString();
  let start;
  try {
    start = new URL(url);
    if (!/^https?:$/.test(start.protocol)) throw new Error("not http");
    await checkHost(start.hostname);
  } catch {
    return { status: "unavailable", checkedAt, reason: "The live URL is not a public web address." };
  }
  const deadline = Date.now() + budgetMs;
  let browser;
  try {
    browser = await launch();
  } catch {
    return { status: "unavailable", checkedAt, reason: "The browser used to read the live app could not start on this server." };
  }
  try {
    const context = await browser.newContext({ userAgent: "Mozilla/5.0 (compatible; GreenlightReader/1.0; +https://greenlight-api-xi.vercel.app)", viewport: { width: 1280, height: 800 } });
    await context.route("**/*", (route) => {
      const req = route.request();
      let host;
      try {
        const u = new URL(req.url());
        if (!/^(https?|data|blob):$/.test(u.protocol)) return route.abort();
        host = u.hostname;
      } catch {
        return route.abort();
      }
      if (host && isBlocked(host)) return route.abort();
      if (["media", "font"].includes(req.resourceType())) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    const pages = [];
    const first = await readPage(page, start.toString(), { timeoutMs });
    if (new URL(first.url).origin !== start.origin && isBlocked(new URL(first.url).hostname)) throw new Error("redirected to a private address");
    pages.push(first);
    const shot = await page.screenshot({ type: "jpeg", quality: 55, fullPage: false }).catch(() => null);
    // A few more same-origin pages, from the start page's own links.
    const seen = new Set([new URL(first.url).href.split("#")[0]]);
    const next = first.links
      .map((l) => {
        try {
          const u = new URL(l.href);
          return u.origin === new URL(first.url).origin ? u.href.split("#")[0] : null;
        } catch {
          return null;
        }
      })
      .filter((h) => h && !seen.has(h) && seen.add(h));
    for (const href of next.slice(0, Math.max(0, maxPages - 1))) {
      if (Date.now() + timeoutMs > deadline) break;
      try {
        pages.push(await readPage(page, href, { timeoutMs }));
      } catch {
        // a page that does not load is skipped
      }
    }
    return { status: "ok", checkedAt, pages, screenshot: shot ? `data:image/jpeg;base64,${shot.toString("base64")}` : null };
  } catch (err) {
    return { status: "unavailable", checkedAt, reason: /Timeout/i.test(String(err?.message)) ? "The live app did not finish loading in time." : "The live app could not be opened in the browser." };
  } finally {
    await browser.close().catch(() => {});
  }
}
