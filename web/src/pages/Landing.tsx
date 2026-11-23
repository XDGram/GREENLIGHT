import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useInView, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { guestApi } from "../api";
import { Logo } from "../components/Chrome";
import { useRouter } from "../router";
import { CheckForm } from "./CheckPage";

// The public landing page. Warm paper, serif headlines and the product itself as the picture:
// the hero frame is a Greenlight result whose claims tick as it scrolls into view. Elements such
// as the buttons, switches, loader and check marks are adapted from Uiverse.io (see uiverse.css).

const ADMIN_LOGIN = "/approve/login?next=%2Fapp";
const ease = [0.22, 1, 0.36, 1] as const;

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const still = useReducedMotion();
  return (
    <motion.div className={className} initial={still ? false : { opacity: 0, y: 26 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10% 0px" }} transition={{ duration: 0.8, ease, delay }}>
      {children}
    </motion.div>
  );
}

/** A small icon tile set between the words of the headline. */
function Tile({ kind, delay }: { kind: "doc" | "browser" | "check"; delay: number }) {
  const still = useReducedMotion();
  const icon =
    kind === "doc" ? (
      <path d="M7 3.5h7.5L19 8v12.5H7z M14.5 3.5V8H19 M10 12h6 M10 15.5h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    ) : kind === "browser" ? (
      <>
        <rect x="3.5" y="5" width="17" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3.5 9h17" stroke="currentColor" strokeWidth="1.8" />
        <path d="M11 11.5l5.5 2.6-2.3.6-1 2.4z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      </>
    ) : (
      <path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    );
  return (
    <motion.span className={`tile ${kind}`} aria-hidden="true" initial={still ? false : { opacity: 0, scale: 0.4, rotate: -12 }} animate={{ opacity: 1, scale: 1, rotate: kind === "browser" ? 4 : kind === "check" ? -4 : 0 }} transition={{ type: "spring", stiffness: 260, damping: 16, delay }}>
      <svg viewBox="0 0 24 24">{icon}</svg>
    </motion.span>
  );
}

const ink = { fill: "none", stroke: "#111", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** Hand-drawn doodles around the hero. They bob gently and drift apart as you scroll. */
function Doodles({ progress }: { progress: MotionValue<number> }) {
  const still = useReducedMotion();
  const left = useTransform(progress, [0, 1], still ? [0, 0] : [0, -120]);
  const right = useTransform(progress, [0, 1], still ? [0, 0] : [0, -170]);
  return (
    <div className="doodles" aria-hidden="true">
      <motion.div className="dd d-bubble" style={{ y: left }}>
        <svg viewBox="0 0 120 100">
          <path d="M20 18 C 40 6, 96 6, 108 26 C 118 44, 104 66, 74 70 L 52 72 L 34 90 L 38 70 C 16 66, 6 48, 12 32 C 14 26, 16 22, 20 18 Z" {...ink} />
          <path d="M34 32 h46 M34 44 h52 M34 56 h34" {...ink} />
        </svg>
      </motion.div>
      <motion.div className="dd d-bug" style={{ y: left }}>
        <svg viewBox="0 0 110 110">
          <ellipse cx="55" cy="60" rx="20" ry="27" {...ink} />
          <path d="M55 34 v52 M40 46 C 30 40, 26 36, 22 30 M70 46 C 80 40, 84 36, 88 30 M35 62 h-16 M75 62 h16 M40 78 C 32 84, 28 88, 24 94 M70 78 C 78 84, 82 88, 86 94" {...ink} />
          <circle cx="55" cy="30" r="8" {...ink} />
          <path d="M50 22 L 44 12 M60 22 L 66 12" {...ink} />
          <path d="M14 14 L 96 104" stroke="var(--pink)" strokeWidth="4" strokeLinecap="round" fill="none" />
        </svg>
      </motion.div>
      <motion.div className="dd d-yes" style={{ y: right }}>
        <svg viewBox="0 0 150 110">
          <path d="M30 22 C 60 4, 128 10, 138 42 C 146 70, 112 90, 74 88 C 56 88, 40 84, 30 76 L 12 96 L 18 70 C 6 58, 6 36, 30 22 Z" {...ink} />
          <text x="40" y="62" fontFamily="Caveat, cursive" fontWeight="600" fontSize="34" fill="#111" transform="rotate(-8 75 55)">
            Passed!
          </text>
        </svg>
      </motion.div>
      <motion.div className="dd d-cursor" style={{ y: right }}>
        <svg viewBox="0 0 100 100">
          <path d="M30 24 L 72 52 L 52 56 L 62 78 L 54 82 L 44 60 L 30 74 Z" {...ink} fill="#fff" />
          <path d="M18 14 L 24 20 M30 8 L 32 16 M8 28 L 16 30" {...ink} />
        </svg>
      </motion.div>
      <motion.div className="dd d-box" style={{ y: left }}>
        <svg viewBox="0 0 90 90">
          <path d="M18 20 C 34 16, 56 17, 70 20 C 72 36, 72 56, 69 70 C 52 73, 34 72, 20 69 C 17 52, 16 36, 18 20 Z" {...ink} />
          <path d="M28 44 L 42 58 L 80 10" stroke="var(--blue)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </motion.div>
      <motion.div className="dd d-stars" style={{ y: right }}>
        <svg viewBox="0 0 120 90">
          <path d="M20 46 l 6 -14 l 6 14 l 14 2 l -11 9 l 4 14 l -13 -8 l -13 8 l 4 -14 l -11 -9 z" {...ink} />
          <path d="M66 30 l 5 -11 l 5 11 l 11 2 l -9 7 l 3 11 l -10 -6 l -10 6 l 3 -11 l -9 -7 z" {...ink} />
          <path d="M92 60 l 4 -9 l 4 9 l 9 1 l -7 6 l 3 9 l -9 -5 l -8 5 l 2 -9 l -7 -6 z" {...ink} />
        </svg>
      </motion.div>
      <span className="dash dash-1" />
      <span className="dash dash-2" />
      <span className="dash dash-3" />
      <span className="dash dash-4" />
    </div>
  );
}

const CLAIMS = [
  { text: "Visitors can add a product to the cart", ok: true },
  { text: "The cart shows the total", ok: true },
  { text: "Users can reset their password", ok: false },
];

/** The hero picture: a Greenlight result in a browser window. Claims tick as you scroll. */
function ProductFrame() {
  const ref = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], still ? [0, 0] : [18, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], still ? [1, 1] : [0.9, 1]);
  const [ticked, setTicked] = useState(still ? CLAIMS.length : 0);
  useEffect(() => {
    if (still) return;
    return scrollYProgress.on("change", (v) => setTicked(v > 0.92 ? 3 : v > 0.78 ? 2 : v > 0.62 ? 1 : 0));
  }, [scrollYProgress, still]);
  const passed = CLAIMS.slice(0, ticked).filter((c) => c.ok).length;
  const done = ticked >= CLAIMS.length;

  return (
    <div className="frame-stage" ref={ref}>
      <motion.div className="window" style={{ rotateX, scale }} role="img" aria-label="Example Greenlight result: two claims passed, one failed, with what Kane saw and a suggested fix.">
        <div className="window-bar">
          <span className="lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="window-url">greenlight · check · acme/shop</span>
        </div>
        <div className="window-body">
          <div className="res-main">
            <div className="res-head">
              <span className="res-k">Verdict · tested by Kane on shop.example.com</span>
              <span className={`res-word ${done ? "fail" : ""}`}>{done ? "Failed" : "Testing"}</span>
              <span className="res-sub">
                {done ? (
                  <>
                    {passed} of {CLAIMS.length} claims passed · 94 credits
                  </>
                ) : (
                  <span className="res-run">
                    <span className="dash-loader" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    Kane is using the live app
                  </span>
                )}
              </span>
            </div>
            <ul className="res-claims">
              {CLAIMS.map((c, i) => {
                const on = i < ticked;
                return (
                  <li key={c.text} className={on ? (c.ok ? "p" : "f") : ""}>
                    <span className={`uv-check ${on ? "on" : ""} ${!c.ok ? "fail" : ""}`} aria-hidden="true" />
                    <span className="res-text">{c.text}</span>
                    <span className="res-tag">{on ? (c.ok ? "Passed" : "Failed") : "Queued"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className={`res-side ${done ? "on" : ""}`}>
            <span className="res-k">What Kane saw</span>
            <p>“Forgot password?” opens /reset-password, which returns a 404 page.</p>
            <span className="res-k">Suggested fix</span>
            <pre className="res-diff">
              <span className="del">- Users can reset their password</span>
              {"\n"}
              <span className="add">+ add app/reset-password/page.tsx</span>
            </pre>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/** Step 3 card: the loader, then the verdict, once the card is on screen. */
function MiniRun() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const still = useReducedMotion();
  const [phase, setPhase] = useState(still ? 3 : 0);
  useEffect(() => {
    if (!inView || still) return;
    const ts = [setTimeout(() => setPhase(1), 1600), setTimeout(() => setPhase(2), 2100), setTimeout(() => setPhase(3), 2600)];
    return () => ts.forEach(clearTimeout);
  }, [inView, still]);
  return (
    <div className="mini" ref={ref}>
      {phase === 0 ? (
        <div className="mini-run">
          <span className="dash-loader" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>Kane is testing…</span>
        </div>
      ) : (
        <ul className="mini-list">
          {["Add to cart works", "Cart shows the total", "Password reset works"].map((t, i) => (
            <li key={t}>
              <span className={`uv-check ${phase > i ? "on" : ""} ${i === 2 ? "fail" : ""}`} aria-hidden="true" />
              {t}
              <b className={i === 2 ? "f" : "p"}>{phase > i ? (i === 2 ? "Failed" : "Passed") : ""}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MiniApprove() {
  const [on, setOn] = useState([true, true, false]);
  const n = on.filter(Boolean).length;
  const labels = ["Add to cart works", "Cart shows the total", "Order email arrives"];
  return (
    <div className="mini">
      <ul className="mini-list">
        {labels.map((t, i) => (
          <li key={t}>
            <label className="uv-switch small">
              <input type="checkbox" checked={on[i]} onChange={() => setOn((o) => o.map((x, j) => (j === i ? !x : x)))} aria-label={`Test “${t}”`} />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-inner" />
                <span className="switch-knob" />
              </span>
            </label>
            {t}
          </li>
        ))}
      </ul>
      <div className="mini-cost">
        <span>
          {n} claim{n === 1 ? "" : "s"}
        </span>
        <b>{n ? 20 + n * 37 : 0} credits</b>
      </div>
    </div>
  );
}

function MiniPaste() {
  return (
    <div className="mini">
      <div className="mini-field">
        <span>GitHub repository</span>
        <b>github.com/acme/shop</b>
      </div>
      <div className="mini-field">
        <span>Live app URL</span>
        <b>shop.example.com</b>
      </div>
      <div className="mini-field area">
        <span>README.md</span>
        <code>- Visitors can add a product to the cart</code>
        <code>- The cart shows the total</code>
        <code>- Users can reset their password</code>
      </div>
    </div>
  );
}

export function Landing({ googleUrl, guestMode, onEntered }: { googleUrl: string | null; guestMode: boolean; sample: boolean; onEntered: () => Promise<void> }) {
  const { navigate } = useRouter();
  const [started, setStarted] = useState(false);
  const still = useReducedMotion();
  // The first call starts a visitor session (a cookie on this browser): no sign-up.
  const start = async () => {
    if (started) return;
    await guestApi.start();
    setStarted(true);
  };
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress: heroP } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  useEffect(() => {
    document.title = "Greenlight · Does your app do what its README says?";
  }, []);

  return (
    <div className="land">
      <header className="nav">
        <a href="/app" className="brand">
          <Logo size={26} />
          <span className="brand-name">Greenlight</span>
        </a>
        <nav className="nav-links" aria-label="Main">
          <a href="#how" onClick={(e) => (e.preventDefault(), go("how"))}>
            How it works
          </a>
          <a href="#honest" onClick={(e) => (e.preventDefault(), go("honest"))}>
            Verdicts
          </a>
          <a href="#check" onClick={(e) => (e.preventDefault(), go("check"))}>
            Check an app
          </a>
        </nav>
        <span className="nav-right">
          {googleUrl ? (
            <a className="pill-link" href={googleUrl}>
              Sign in
            </a>
          ) : null}
          <button type="button" className="uv-button small" onClick={() => go("check")}>
            Check my app
          </button>
        </span>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-h" ref={heroRef}>
          <Doodles progress={heroP} />
          <motion.a className="announce" href="#check" onClick={(e) => (e.preventDefault(), go("check"))} initial={still ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
            <b>Free</b> One run per visitor, no sign-up <span aria-hidden="true">→</span>
          </motion.a>
          <motion.h1 id="hero-h" initial={still ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.05 }}>
            Your
            <Tile kind="doc" delay={0.45} />
            README makes{" "}
            <span className="scribble">
              promises.
              <svg viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true">
                <motion.path d="M4 16 C 60 6, 110 22, 160 12 S 250 6, 296 14 M 30 21 C 100 14, 190 22, 270 18" fill="none" stroke="var(--pink)" strokeWidth="4" strokeLinecap="round" initial={still ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease, delay: 0.9 }} />
              </svg>
            </span>
            <br />
            Kane
            <Tile kind="browser" delay={0.7} />
            checks them
            <Tile kind="check" delay={0.95} />
          </motion.h1>
          <motion.p initial={still ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.25 }}>
            Paste a GitHub repo and its live URL. Kane tests every claim in the README on your deployed app, in a real browser, and tells you what passed, what failed and how to fix it.
          </motion.p>
          <motion.div className="hero-cta" initial={still ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.35 }}>
            <button type="button" className="uv-button" onClick={() => go("check")}>
              Check my app <span className="uv-tail">─ it’s free</span>
            </button>
            <button type="button" className="ghost-btn" onClick={() => go("how")}>
              See how it works <span aria-hidden="true">→</span>
            </button>
          </motion.div>
          <span className="hero-note">No sign-up required</span>
        </section>

        <section className="showcase" aria-label="An example result">
          <ProductFrame />
        </section>

        <section id="how" className="sec" aria-labelledby="how-h">
          <Reveal className="sec-head">
            <span className="eyebrow-tag">How it works</span>
            <h2 id="how-h">Three steps to an honest answer</h2>
          </Reveal>
          <div className="how-grid">
            <Reveal className="how-card">
              <MiniPaste />
              <h3>
                <span>1</span> Paste your repo
              </h3>
              <p>Your GitHub link, the live URL and, if you like, your README. Every bullet point becomes a claim.</p>
            </Reveal>
            <Reveal className="how-card" delay={0.1}>
              <MiniApprove />
              <h3>
                <span>2</span> Approve the cost
              </h3>
              <p>Switch claims on or off and see the exact credit cost. Clicking Run approves exactly that, nothing more.</p>
            </Reveal>
            <Reveal className="how-card" delay={0.2}>
              <MiniRun />
              <h3>
                <span>3</span> Read the verdict
              </h3>
              <p>Kane uses your live app in a real browser. Each claim passes or fails, with what it saw and a fix.</p>
            </Reveal>
          </div>
        </section>

        <section id="honest" className="sec" aria-labelledby="honest-h">
          <Reveal className="sec-head">
            <span className="eyebrow-tag">Verdicts</span>
            <h2 id="honest-h">Three answers. Never a guess.</h2>
          </Reveal>
          <div className="verdicts">
            <Reveal className="vcard p">
              <span className="uv-check on" aria-hidden="true" />
              <h3>Passed</h3>
              <p>Kane did what the claim says on your live app, and it worked.</p>
            </Reveal>
            <Reveal className="vcard f" delay={0.08}>
              <span className="uv-check on fail" aria-hidden="true" />
              <h3>Failed</h3>
              <p>It didn’t work. You get what Kane saw on the page and a suggested fix.</p>
            </Reveal>
            <Reveal className="vcard u" delay={0.16}>
              <span className="result-mark unknown" aria-hidden="true" />
              <h3>Could not verify</h3>
              <p>Kane can’t check it from a browser, like an email arriving. It says so instead of guessing.</p>
            </Reveal>
          </div>
        </section>

        <section id="check" className="sec check" aria-labelledby="check-h">
          <Reveal className="sec-head center">
            <span className="eyebrow-tag">Check an app</span>
            <h2 id="check-h">Does your app do what its README says?</h2>
            <p>One free run, up to two claims. You see the cost before anything runs.</p>
          </Reveal>
          <Reveal className="check-wrap" delay={0.1}>
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
              <p className="small" style={{ textAlign: "center" }}>
                Visitor access is not enabled on this server.
              </p>
            )}
          </Reveal>
        </section>
      </main>

      <footer className="foot">
        <span className="brand">
          <Logo size={20} />
          <span className="brand-name">Greenlight</span>
        </span>
        <span>Real browser tests by Kane.</span>
        <span className="sp" />
        {googleUrl ? <a href={googleUrl}>Sign in with Google</a> : null}
        <a href={ADMIN_LOGIN}>Administrator sign-in</a>
        <a href="https://uiverse.io" rel="noopener">
          Some UI elements from Uiverse.io
        </a>
      </footer>
    </div>
  );
}
