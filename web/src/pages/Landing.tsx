import { useEffect, useState } from "react";
import { guestApi } from "../api";
import { Logo } from "../components/Chrome";
import { DotField } from "../components/DotField";
import { LoopIllustration } from "../components/LoopIllustration";
import { useRouter } from "../router";
import { CheckForm } from "./CheckPage";
import "../styles/landing.css";

// The public landing page: a night-green hero that fades to white, the product in a window, the
// loop as an illustration, then the check itself. One typeface (Geist), upright, on one grid.

const ADMIN_LOGIN = "/approve/login?next=%2Fapp";
const REPO = "https://github.com/XDGram/GREENLIGHT";

export function Landing({ googleUrl, guestMode, onEntered }: { googleUrl: string | null; guestMode: boolean; sample: boolean; onEntered: () => Promise<void> }) {
  const { navigate } = useRouter();
  const [started, setStarted] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // The first call starts a visitor session (a cookie on this browser): no sign-up.
  const start = async () => {
    if (started) return;
    await guestApi.start();
    setStarted(true);
  };
  const go = (id: string) => (e?: React.MouseEvent) => {
    e?.preventDefault();
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  };

  useEffect(() => {
    document.title = "Greenlight · Your README makes promises. Kane checks them.";
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="lp">
      <header className={`lp-nav ${scrolled ? "is-scrolled" : ""}`}>
        <div className="lp-nav-in">
          <a href="/app" className="lp-brand" aria-label="Greenlight home">
            <Logo size={22} />
            <span>Greenlight</span>
          </a>
          <nav className="lp-links" aria-label="Main">
            <a href="#how" onClick={go("how")}>
              How it works
            </a>
            <a href="#claude" onClick={go("claude")}>
              Claude Code
            </a>
            <a href="#check" onClick={go("check")}>
              Check an app
            </a>
            <a href={REPO} rel="noopener">
              GitHub
            </a>
          </nav>
          <div className="lp-nav-right">
            {googleUrl ? (
              <a className="lp-signin" href={googleUrl}>
                Sign in
              </a>
            ) : null}
            <a className="lp-btn lp-btn-sm" href="#check" onClick={go("check")}>
              Check your app
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="hero-h">
          <DotField />
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
            <p>Paste your GitHub repo and live URL. Kane CLI tests every claim on your deployed app in a real browser and tells you what passed, what failed and how to fix it.</p>
            <div className="lp-cta">
              <a className="lp-btn" href="#check" onClick={go("check")}>
                Check your app
              </a>
              <a className="lp-btn-ghost" href="#how" onClick={go("how")}>
                See how it works
              </a>
            </div>
            <span className="lp-hero-note">Free to try · no sign-up</span>
          </div>
        </section>

        <section className="lp-sec lp-proof" aria-labelledby="proof-h">
          <div className="lp-wrap">
            <h2 id="proof-h">Proof, not promises</h2>
            <p className="lp-lead">
              Every claim gets a <strong>real verdict from a real browser</strong>, with what Kane saw when something breaks.
            </p>
            <ProductWindow />
          </div>
        </section>

        <section id="how" className="lp-sec" aria-labelledby="how-h">
          <div className="lp-wrap">
            <span className="lp-eyebrow">How it works</span>
            <h2 id="how-h">From README to green light</h2>
            <p className="lp-lead">Four steps, and the last one repeats until everything passes.</p>
            <div className="lp-figure">
              <LoopIllustration />
            </div>
            <ol className="lp-steps">
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

        <section id="claude" className="lp-sec lp-dark" aria-labelledby="claude-h">
          <div className="lp-wrap lp-split">
            <div>
              <span className="lp-eyebrow on-dark">Claude Code</span>
              <h2 id="claude-h">One paste. It fixes, Kane confirms.</h2>
              <p className="lp-lead on-dark">
                Every result has a <strong>Fix it with Claude Code</strong> message. Paste it into Claude Code and it gets your code, reads Kane’s verdict, fixes what failed, pushes and asks Kane to re-check until every claim passes.
              </p>
              <ul className="lp-ticks">
                <li>Claims stay as you approved them: Claude Code can only re-run them</li>
                <li>The result page updates live while it works</li>
                <li>Works on Windows, macOS and Linux</li>
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
                {" field\n↑ pushed 2ccfdcf · deploy is live\n⟳ asked Kane to re-check\n\n"}
                <span className="t-green">✓ cart          passed</span>
                {"\n"}
                <span className="t-green">✓ newsletter    passed</span>
              </pre>
            </div>
          </div>
        </section>

        <section id="check" className="lp-sec" aria-labelledby="check-h">
          <div className="lp-wrap lp-narrow">
            <span className="lp-eyebrow">Check an app</span>
            <h2 id="check-h">Does your app do what its README says?</h2>
            <p className="lp-lead">One free run with up to two claims. You see the cost before anything runs.</p>
            <div className="lp-check">
              {guestMode ? (
                <CheckForm
                  session={null}
                  beforeFirstCall={start}
                  onStarted={async (id) => {
                    navigate(`/app/check/${id}`);
                    await onEntered();
                  }}
                />
              ) : (
                <p className="small">Visitor access is not enabled on this server.</p>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <span className="lp-brand dark">
            <Logo size={18} />
            <span>Greenlight</span>
          </span>
          <span className="lp-foot-note">Real browser tests by Kane CLI · fixes by Claude Code</span>
          <span className="lp-foot-sp" />
          {googleUrl ? <a href={googleUrl}>Sign in with Google</a> : null}
          <a href={ADMIN_LOGIN}>Administrator</a>
          <a href={REPO} rel="noopener">
            GitHub
          </a>
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
            <span className="lp-eyebrow">Verdict · tested by Kane</span>
            <strong>Failed</strong>
            <span>1 of 2 claims passed</span>
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
