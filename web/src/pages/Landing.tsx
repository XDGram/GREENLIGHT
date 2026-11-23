import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";
import { guestApi } from "../api";
import { Logo } from "../components/Chrome";
import { useRouter } from "../router";
import { CheckForm } from "./CheckPage";

// The public landing page: a split black/white hero with a live 3D object, then one section per
// step of a check, each with a floating product card. A rail on the left tracks where you are.
// Motion is tied to scroll and switches off for viewers who prefer reduced motion.

const Blob3D = lazy(() => import("../components/Blob3D"));
const ADMIN_LOGIN = "/approve/login?next=%2Fapp";

const SECTIONS = [
  { id: "top", label: "Your README" },
  { id: "how", label: "How it works" },
  { id: "approve", label: "You approve" },
  { id: "verdict", label: "The verdict" },
  { id: "fix", label: "Fix it" },
  { id: "check", label: "Run a check" },
] as const;

const ease = [0.22, 1, 0.36, 1] as const;

function Reveal({ children, delay = 0, y = 28, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const still = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={still ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ duration: 0.9, ease, delay }}
    >
      {children}
    </motion.div>
  );
}

/** A card that drifts against the scroll inside its section. */
function Float({ children, className, speed = 60, delay = 0 }: { children: ReactNode; className?: string; speed?: number; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], still ? [0, 0] : [speed, -speed]);
  return (
    <motion.div ref={ref} className={className} style={{ y }} initial={still ? false : { opacity: 0, scale: 0.94 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true, margin: "-10% 0px" }} transition={{ duration: 0.9, ease, delay }}>
      {children}
    </motion.div>
  );
}

function Words({ text, delay = 0 }: { text: string; delay?: number }) {
  const still = useReducedMotion();
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span key={i}>
          <span className="word-mask">
            <motion.span className="word" initial={still ? false : { y: "110%" }} animate={{ y: "0%" }} transition={{ duration: 1, ease, delay: delay + i * 0.06 }}>
              {w}
            </motion.span>
          </span>{" "}
        </span>
      ))}
    </>
  );
}

function useActiveSection() {
  const [active, setActive] = useState<string>("top");
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return active;
}

function Rail({ progress, dark }: { progress: MotionValue<number>; dark: boolean }) {
  const active = useActiveSection();
  const scaleY = useSpring(progress, { stiffness: 120, damping: 30 });
  return (
    <nav className={`rail ${dark ? "dark" : ""}`} aria-label="Sections">
      <span className="rail-line" aria-hidden="true">
        <motion.span className="rail-fill" style={{ scaleY }} />
      </span>
      {SECTIONS.map((s) => (
        <a key={s.id} href={`#${s.id}`} className={active === s.id ? "on" : ""} aria-current={active === s.id ? "true" : undefined}>
          <i aria-hidden="true" />
          {s.label}
        </a>
      ))}
    </nav>
  );
}

const Check = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Arrow = ({ size = 14, down = false }: { size?: number; down?: boolean }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" style={down ? { transform: "rotate(90deg)" } : undefined}>
    <path d="M4 12L12 4M6 4h6v6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function StepChart() {
  return (
    <svg viewBox="0 0 200 70" className="chart" aria-hidden="true">
      <defs>
        <linearGradient id="gl-fade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#0a0a0a" stopOpacity="0.35" />
          <stop offset="1" stopColor="#0a0a0a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 52 C20 50 28 40 44 42 S70 56 86 46 108 22 122 30 146 50 160 26 184 10 200 18 V70 H0z" fill="url(#gl-fade)" />
      <path d="M0 52 C20 50 28 40 44 42 S70 56 86 46 108 22 122 30 146 50 160 26 184 10 200 18" fill="none" stroke="#0a0a0a" strokeWidth="1.6" />
      <circle cx="122" cy="30" r="4" fill="#0a0a0a" stroke="#fff" strokeWidth="2" />
    </svg>
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
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });

  const { scrollYProgress } = useScroll();
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress: heroP } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const objY = useTransform(heroP, [0, 1], still ? [0, 0] : [0, 140]);
  const objScale = useTransform(heroP, [0, 1], still ? [1, 1] : [1, 0.82]);
  const cardsY = useTransform(heroP, [0, 1], still ? [0, 0] : [0, -90]);
  const [railDark, setRailDark] = useState(true);
  useEffect(() => heroP.on("change", (v) => setRailDark(v < 0.82)), [heroP]);

  useEffect(() => {
    document.title = "Greenlight · Does your app do what its README says?";
  }, []);

  return (
    <div className="land">
      <Rail progress={scrollYProgress} dark={railDark} />

      <header className="hero" id="top" ref={heroRef}>
        <div className="hero-dark">
          <nav className="hero-nav" aria-label="Main">
            <a href="#how" onClick={(e) => (e.preventDefault(), go("how"))}>
              How it works
            </a>
            <a href="#verdict" onClick={(e) => (e.preventDefault(), go("verdict"))}>
              Results
            </a>
            <a href="#fix" onClick={(e) => (e.preventDefault(), go("fix"))}>
              Fixes
            </a>
            <a href="#check" onClick={(e) => (e.preventDefault(), go("check"))}>
              Check an app
            </a>
          </nav>
          <div className="hero-title">
            <motion.span className="hero-kicker" initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.2 }}>
              Real browser tests by Kane
            </motion.span>
            <h1>
              <Words text="Ship what your" />
              <br />
              <Words text="README promises" delay={0.18} />
            </h1>
            <motion.p initial={still ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.55 }}>
              Paste a GitHub repo and its live URL. Kane tests every claim in the README on the deployed app and tells you what passed, what failed and how to fix it.
            </motion.p>
          </div>
          <button type="button" className="scroll-cue" onClick={() => go("how")} aria-label="Scroll to how it works">
            <span />
          </button>
        </div>

        <div className="hero-light">
          <div className="hero-top">
            <a href="/app" className="brand" aria-label="Greenlight home">
              <Logo size={34} />
            </a>
            <span className="hero-actions">
              {googleUrl ? (
                <a className="pill ghost" href={googleUrl}>
                  Sign in
                </a>
              ) : null}
              <button type="button" className="pill" onClick={() => go("check")}>
                Check my app
              </button>
            </span>
          </div>

          <motion.div className="hero-object" style={{ y: objY, scale: objScale }}>
            <Suspense fallback={<div className="gl black" />}>
              <Blob3D shape="ring" finish="black" spin={heroP} />
            </Suspense>
          </motion.div>

          <motion.div className="hero-cards" style={{ y: cardsY }}>
            <motion.div className="fc fc-total" initial={still ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.5 }}>
              <span className="fc-big">3 / 3</span>
              <span className="fc-k">Claims passed</span>
              <span className="fc-btn" aria-hidden="true">
                <Arrow />
              </span>
            </motion.div>
            <motion.div className="fc fc-toast" initial={still ? false : { opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.9, ease, delay: 0.8 }}>
              <span className="avatar-k" aria-hidden="true">
                K
              </span>
              <span>
                Kane clicked “Add to cart”
                <small>00:04 · shop.example.com</small>
              </span>
            </motion.div>
            <motion.div className="fc fc-chart" initial={still ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.65 }}>
              <span className="fc-mid">94 credits</span>
              <span className="fc-k">Approved before the run</span>
              <StepChart />
            </motion.div>
            <motion.div className="fc fc-dark" initial={still ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.95 }}>
              <span className="fc-mid">Passed</span>
              <span className="fc-tick" aria-hidden="true">
                <Check size={16} />
              </span>
              <span className="fc-k">The cart shows the total</span>
            </motion.div>
          </motion.div>
        </div>
      </header>

      <main id="main">
        <section className="sec" id="how" aria-labelledby="how-h">
          <Reveal className="sec-text">
            <h2 id="how-h">
              Paste a repo.
              <br />
              Get the truth.
            </h2>
            <p>Every bullet point in your README becomes a claim. Kane opens your live app in a real browser and uses it the way a visitor would, one claim at a time. No mocks, no screenshots of a demo.</p>
            <button type="button" className="pill ghost sm" onClick={() => go("check")}>
              Try it free <Arrow size={12} />
            </button>
          </Reveal>
          <div className="sec-art art-how">
            <Float className="panel-grey" speed={30}>
              <span className="panel-big">3</span>
              <span className="panel-k">Possible verdicts</span>
              <div className="plates" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i} style={{ ["--i" as string]: i }} />
                ))}
              </div>
            </Float>
            <Float className="chip-kane" speed={70} delay={0.1}>
              <span className="avatar-k" aria-hidden="true">
                K
              </span>
              <span>
                Kane
                <small>Real browser · live app</small>
              </span>
            </Float>
            <Float className="panel-black small-black" speed={90} delay={0.2}>
              <span className="pb-title">Your claims</span>
              <span className="pb-k">Found in README.md</span>
              <span className="dots" aria-hidden="true">
                <i className="p" />
                <i className="p" />
                <i className="f" />
                <b>+3</b>
              </span>
            </Float>
          </div>
        </section>

        <section className="sec" id="approve" aria-labelledby="approve-h">
          <Reveal className="sec-text">
            <h2 id="approve-h">
              You approve
              <br />
              exactly what runs
            </h2>
            <p>Before anything happens you see each claim and the exact credit cost. Clicking Run approves those tests and that cost, nothing more. Visitors get one free run, up to two claims.</p>
          </Reveal>
          <div className="sec-art art-approve">
            <Float className="panel-black tall" speed={50}>
              <span className="pb-title lg">
                Cost before
                <br />
                you run
              </span>
              <span className="pb-stat">
                94<small>credits</small>
              </span>
              <span className="pb-k">2 claims · about 37 each, plus 20 per run</span>
              <span className="pb-stat">
                1<small>free run</small>
              </span>
              <span className="pb-k">For every visitor, no account</span>
              <span className="pb-row">
                <span className="ring-ic" aria-hidden="true">
                  <Check size={12} />
                </span>
                You approved exactly these tests.
              </span>
            </Float>
          </div>
        </section>

        <section className="sec flip" id="verdict" aria-labelledby="verdict-h">
          <div className="sec-art art-verdict">
            <div className="silver" aria-hidden="true">
              <Suspense fallback={<div className="gl silver" />}>
                <Blob3D shape="blob" finish="silver" />
              </Suspense>
            </div>
            <Float className="panel-grey verdict-card" speed={30}>
              <span className="pb-title dark lg">
                Your
                <br />
                verdict
              </span>
              <ul className="vlist">
                <li className="p">
                  <i /> Add a product to the cart <b>Passed</b>
                </li>
                <li className="p">
                  <i /> The cart shows the total <b>Passed</b>
                </li>
                <li className="f">
                  <i /> Reset your password <b>Failed</b>
                </li>
                <li className="u">
                  <i /> Order email arrives <b>Could not verify</b>
                </li>
              </ul>
            </Float>
            <Float className="report" speed={80} delay={0.15}>
              <span className="report-side">GREENLIGHT REPORT</span>
              <span className="report-top">acme/shop</span>
              <span className="report-mark">
                <Logo size={22} />
              </span>
              <span className="report-foot">
                <b>2</b> passed · <b>1</b> failed · <b>1</b> unverified
              </span>
            </Float>
          </div>
          <Reveal className="sec-text">
            <h2 id="verdict-h">
              Your README,
              <br />
              annotated
            </h2>
            <p>Each claim comes back Passed, Failed or Could not verify, with what Kane saw on the page. When Kane can’t check something, like an email arriving, it says so instead of guessing.</p>
          </Reveal>
        </section>

        <section className="sec" id="fix" aria-labelledby="fix-h">
          <Reveal className="sec-text">
            <h2 id="fix-h">
              Fix what failed,
              <br />
              then check again
            </h2>
            <p>Every failed claim comes with a suggested fix: change the app, or change the README so it stops promising what the app doesn’t do. Then run the check again.</p>
          </Reveal>
          <div className="sec-art art-fix">
            <Float className="panel-black fix-card" speed={50}>
              <span className="pb-title lg">Suggested fix</span>
              <span className="pb-k">Users can reset their password</span>
              <pre className="diff">
                <span className="del">- /reset-password returns 404</span>
                {"\n"}
                <span className="add">+ add app/reset-password/page.tsx</span>
              </pre>
              <span className="prism" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </Float>
          </div>
        </section>

        <section className="sec-check" id="check" aria-labelledby="check-h">
          <Reveal className="check-head">
            <span className="kicker">Run a check</span>
            <h2 id="check-h">Does your app do what its README says?</h2>
            <p>One free run, up to two claims. No account needed. You see the cost before anything runs.</p>
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
        <div className="foot-big" aria-hidden="true">
          Greenlight
        </div>
        <div className="foot-row">
          <span>Tested in a real browser by Kane.</span>
          <span className="sp" />
          {googleUrl ? <a href={googleUrl}>Sign in with Google</a> : null}
          <a href={ADMIN_LOGIN}>Administrator sign-in</a>
        </div>
      </footer>
    </div>
  );
}
