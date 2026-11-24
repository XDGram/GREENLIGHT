import { useEffect, useState } from "react";
import { guestApi } from "../api";
import { Logo } from "../components/Chrome";
import { PixelScatter } from "../components/GlobeField";
import { DotWave } from "../components/DotWave";
import { LoopIllustration } from "../components/LoopIllustration";
import { useRouter } from "../router";
import "../styles/landing.css";

// The public landing page. Night blue fading to white, an upright serif for headlines and Geist for
// everything else, illustrations where they explain something. Every "Check your app" opens the
// app itself (a visitor session starts on the first click; no sign-up).

const ADMIN_LOGIN = "/approve/login?next=%2Fapp";
const REPO = "https://github.com/XDGram/GREENLIGHT";

export function Landing({ googleUrl, guestMode, onEntered }: { googleUrl: string | null; guestMode: boolean; sample: boolean; onEntered: () => Promise<void> }) {
  const { navigate } = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open the app: start a visitor session (a cookie on this browser), then show the app.
  const openApp = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (opening) return;
    if (!guestMode) {
      window.location.assign(googleUrl ?? ADMIN_LOGIN);
      return;
    }
    setOpening(true);
    setError(null);
    try {
      await guestApi.start();
      navigate("/app");
      await onEntered();
    } catch (err) {
      setError((err as Error).message);
      setOpening(false);
    }
  };
  const go = (id: string) => (e?: React.MouseEvent) => {
    e?.preventDefault();
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  };

  useEffect(() => {
    document.title = "Greenlight · Your README makes promises. Kane checks them.";
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const Cta = ({ label = "Check your app", small = false }: { label?: string; small?: boolean }) => (
    <a className={`lp-btn ${small ? "lp-btn-sm" : ""}`} href="/app" onClick={openApp} aria-busy={opening}>
      {opening ? <span className="lp-spin" aria-hidden="true" /> : null}
      {label}
    </a>
  );

  return (
    <div className="lp">
      <header className={`lp-nav ${scrolled ? "is-scrolled" : ""}`}>
        <div className="lp-nav-in">
          <a href="/app" className="lp-brand" aria-label="Greenlight home" onClick={go("top")}>
            <Logo size={20} />
            <span>Greenlight</span>
          </a>
          <nav className="lp-links" aria-label="Main">
            <a href="#how" onClick={go("how")}>
              How it works
            </a>
            <a href="#why" onClick={go("why")}>
              Why Greenlight
            </a>
            <a href="#claude" onClick={go("claude")}>
              Claude Code
            </a>
            <a href={REPO} rel="noopener">
              GitHub
            </a>
          </nav>
          <div className="lp-nav-right">
            {googleUrl ? (
              <a className="lp-signin" href={googleUrl}>
                Log in
              </a>
            ) : null}
            <Cta small />
          </div>
        </div>
      </header>

      <main id="top">
        <section className="lp-hero" aria-labelledby="hero-h">
          <DotWave horizon={0.6} amplitude={1.2} className="lp-wave" />
          <div className="lp-hero-in">
            <a className="lp-badge" href="#claude" onClick={go("claude")}>
              <span className="lp-badge-new">New</span>
              Fix what Kane finds with Claude Code
              <span aria-hidden="true">›</span>
            </a>
            <h1 id="hero-h">
              Your README makes promises.
              <br />
              Kane checks them.
            </h1>
            <p>Greenlight tests every claim in your README on your live app, in a real browser with Kane CLI, and tells you what passed, what failed and how to fix it.</p>
            <div className="lp-cta">
              <Cta />
              <a className="lp-btn-ghost" href="#how" onClick={go("how")}>
                See how it works
              </a>
            </div>
            {error ? (
              <p className="lp-err" role="alert">
                {error}
              </p>
            ) : (
              <ul className="lp-hero-notes" aria-label="What you get">
                <li>Free to try</li>
                <li>No sign-up</li>
                <li>Real browser</li>
              </ul>
            )}
          </div>
        </section>

        <section className="lp-sec lp-proof" aria-labelledby="proof-h">
          <PixelScatter />
          <div className="lp-wrap">
            <h2 id="proof-h">Ship it, then prove it</h2>
            <p className="lp-lead">
              Every claim gets a <strong>verdict from a real browser</strong>, with what Kane saw when something breaks.
            </p>
            <ProductWindow />
          </div>
        </section>

        <section id="how" className="lp-sec lp-deep" aria-labelledby="how-h">
          <DotWave horizon={0.72} amplitude={0.7} className="lp-band-wave" />
          <PixelScatter tone="white" />
          <div className="lp-wrap">
            <span className="lp-eyebrow on-dark">How it works</span>
            <h2 id="how-h">From README to green light</h2>
            <p className="lp-lead on-dark">Four steps. The last one repeats until every claim passes.</p>
            <div className="lp-figure">
              <LoopIllustration />
            </div>
            <ol className="lp-steps on-dark">
              <li>
                <span className="lp-num">01</span>
                <h3>Paste</h3>
                <p>Your GitHub repo, the live URL and your README. Each bullet point becomes a claim.</p>
              </li>
              <li>
                <span className="lp-num">02</span>
                <h3>Kane tests</h3>
                <p>Kane CLI uses your deployed app like a visitor would, one claim at a time.</p>
              </li>
              <li>
                <span className="lp-num">03</span>
                <h3>Verdict</h3>
                <p>Passed or failed for every claim, with what Kane saw and a suggested fix.</p>
              </li>
              <li>
                <span className="lp-num">04</span>
                <h3>Claude Code fixes</h3>
                <p>Paste one message into Claude Code. It fixes, pushes and asks Kane to check again.</p>
              </li>
            </ol>
          </div>
        </section>

        <section id="why" className="lp-sec lp-dotted" aria-labelledby="why-h">
          <div className="lp-wrap">
            <span className="lp-eyebrow">Why Greenlight</span>
            <h2 id="why-h">Honest answers, not screenshots</h2>
            <div className="lp-cards">
              <article className="lp-card">
                <BrowserArt />
                <h3>A real browser, on the real app</h3>
                <p>Kane clicks, types and reads your deployed site. No mocks, no staging copy, no guessing from code.</p>
              </article>
              <article className="lp-card">
                <LockArt />
                <h3>You approve every claim</h3>
                <p>You see exactly what will be tested and what it costs. Agents can re-run your claims, never change them.</p>
              </article>
              <article className="lp-card">
                <VerdictArt />
                <h3>Three plain answers</h3>
                <p>Passed, failed, or could not verify. When something fails you see what Kane saw, not just a red cross.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="claude" className="lp-sec lp-dark" aria-labelledby="claude-h">
          <DotWave horizon={0.62} amplitude={0.8} className="lp-band-wave" />
          <div className="lp-wrap lp-split">
            <div>
              <span className="lp-eyebrow on-dark">Claude Code</span>
              <h2 id="claude-h">One paste. It fixes, Kane confirms.</h2>
              <p className="lp-lead on-dark">
                Every result has a <strong>Fix it with Claude Code</strong> message. Paste it into Claude Code and it gets your code, reads Kane’s verdict, fixes what failed, pushes and asks Kane to check again until every claim passes.
              </p>
              <ul className="lp-ticks">
                <li>Claims stay exactly as you approved them</li>
                <li>The result page updates live while it works</li>
                <li>Windows, macOS and Linux</li>
              </ul>
            </div>
            <div className="lp-term" aria-label="Claude Code fixing a failed claim">
              <div className="lp-term-bar">
                <span />
                <span />
                <span />
                <b>claude code</b>
              </div>
              <pre>
                <span className="t-dim">› Kane: newsletter claim </span>
                <span className="t-red">failed</span>
                {"\n"}
                <span className="t-dim">{'  "Subscription failed. Please try again later."'}</span>
                {"\n\n"}
                {"✎ app.js: read the API's "}
                <span className="t-hl">ok</span>
                {" field\n↑ pushed 2ccfdcf, deploy is live\n⟳ asked Kane to re-check\n\n"}
                <span className="t-green">✓ cart          passed</span>
                {"\n"}
                <span className="t-green">✓ newsletter    passed</span>
              </pre>
            </div>
          </div>
        </section>

        <section className="lp-sec lp-close" aria-labelledby="close-h">
          <DotWave horizon={0.5} amplitude={0.9} className="lp-close-globe" />
          <div className="lp-wrap lp-close-in">
            <h2 id="close-h">Find out what your app really does.</h2>
            <p className="lp-lead on-dark">One free run without signing up. You see the cost before anything runs.</p>
            <div className="lp-cta">
              <Cta />
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <span className="lp-brand">
            <Logo size={18} />
            <span>Greenlight</span>
          </span>
          <span className="lp-foot-note">Real browser tests by Kane CLI. Fixes by Claude Code.</span>
          <span className="lp-foot-sp" />
          <nav className="lp-foot-links" aria-label="Footer">
            {googleUrl ? <a href={googleUrl}>Log in</a> : null}
            <a href={ADMIN_LOGIN}>Administrator</a>
            <a href={REPO} rel="noopener">
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** A still picture of a Greenlight result, laid out like the real result page. */
function ProductWindow() {
  return (
    <div className="lp-window" aria-label="Example Greenlight result">
      <aside className="lp-win-side" aria-hidden="true">
        <Logo size={18} />
        <span className="on" />
        <span />
        <span />
      </aside>
      <div className="lp-win-main">
        <div className="lp-win-top">
          <span className="lp-chip">‹ My checks</span>
          <span className="lp-win-title">greenlight-demo-shop.vercel.app</span>
          <span className="lp-chip">2 claims</span>
        </div>
        <div className="lp-win-body">
          <div className="lp-verdict">
            <span className="lp-kv">
              <span className="lp-small">Verdict</span>
              <span className="lp-kane">Kane CLI</span>
            </span>
            <strong>Failed</strong>
            <span className="lp-small">1 of 2 claims passed</span>
          </div>
          <div className="lp-claims">
            <div className="lp-claim">
              <span className="lp-mark pass">✓</span>
              <span>Users can add items to the cart and the cart count goes up</span>
              <span className="lp-tag pass">Passed</span>
            </div>
            <div className="lp-claim">
              <span className="lp-mark fail">✕</span>
              <span>
                Users can subscribe to the newsletter and see a confirmation
                <span className="lp-saw">Kane saw: “Subscription failed. Please try again later.” on every attempt.</span>
              </span>
              <span className="lp-tag fail">Failed</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ART = { ink: "#0b1437", line: "#dbe3f3", soft: "#eef3fc", blue: "#2563eb", sky: "#93c5fd", lime: "#d9f24a" };

function BrowserArt() {
  return (
    <svg className="lp-art" viewBox="0 0 280 150" aria-hidden="true">
      <rect x="20" y="14" width="240" height="122" rx="12" fill="#fff" stroke={ART.line} />
      <path d="M20 26 a12 12 0 0 1 12 -12 h216 a12 12 0 0 1 12 12 v10 h-240 z" fill={ART.soft} />
      <circle cx="34" cy="25" r="3" fill={ART.line} />
      <circle cx="44" cy="25" r="3" fill={ART.line} />
      <circle cx="54" cy="25" r="3" fill={ART.line} />
      <rect x="74" y="20" width="150" height="10" rx="5" fill="#fff" stroke={ART.line} />
      <rect x="36" y="50" width="96" height="10" rx="5" fill={ART.soft} />
      <rect x="36" y="68" width="140" height="8" rx="4" fill={ART.soft} />
      <rect x="36" y="94" width="110" height="26" rx="8" fill="#fff" stroke={ART.line} />
      <rect x="156" y="94" width="74" height="26" rx="13" fill={ART.blue} />
      <path d="M206 104 L206 130 L212 124 L217 135 L222 133 L217 122 L225 122 Z" fill="#fff" stroke={ART.ink} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function LockArt() {
  return (
    <svg className="lp-art" viewBox="0 0 280 150" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(40 ${20 + i * 38})`}>
          <rect width="200" height="30" rx="8" fill="#fff" stroke={ART.line} />
          <rect x="10" y="8" width="14" height="14" rx="4" fill={i < 2 ? ART.blue : "#fff"} stroke={i < 2 ? ART.blue : ART.line} />
          {i < 2 ? <path d="M13 15 L16 18 L21 12" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
          <rect x="34" y="11" width={[120, 96, 132][i]} height="8" rx="4" fill={ART.soft} />
        </g>
      ))}
      <g transform="translate(206 86)">
        <rect width="44" height="38" rx="9" fill={ART.ink} />
        <path d="M13 8 v-6 a9 9 0 0 1 18 0 v6" fill="none" stroke={ART.ink} strokeWidth="4" transform="translate(0 0)" />
        <circle cx="22" cy="19" r="4" fill={ART.lime} />
        <rect x="20.5" y="21" width="3" height="8" rx="1.5" fill={ART.lime} />
      </g>
    </svg>
  );
}

function VerdictArt() {
  const rows: [string, string, string][] = [
    ["#16a34a", "Passed", "M-4 0 L-1 3 L5 -3"],
    ["#dc2626", "Failed", "M-3 -3 L3 3 M3 -3 L-3 3"],
    ["#94a3b8", "Could not verify", "M-3 0 L3 0"],
  ];
  return (
    <svg className="lp-art" viewBox="0 0 280 150" aria-hidden="true">
      {rows.map(([c, t, d], i) => (
        <g key={t} transform={`translate(40 ${22 + i * 38})`}>
          <rect width="200" height="30" rx="15" fill="#fff" stroke={ART.line} />
          <circle cx="16" cy="15" r="9" fill={c} />
          <path d={d} transform="translate(16 15)" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <text x="34" y="19.5" fontSize="12" fontWeight="600" fontFamily="Geist Sans, Geist, sans-serif" fill={ART.ink}>
            {t}
          </text>
        </g>
      ))}
    </svg>
  );
}
