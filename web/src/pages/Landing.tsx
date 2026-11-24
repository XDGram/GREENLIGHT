import { useEffect, useRef, useState, type ReactNode } from "react";
import { LayoutGroup, motion, useInView, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { guestApi } from "../api";
import { Logo } from "../components/Chrome";
import { Cloud, CloudBank, Stars } from "../components/Sky";
import { useRouter } from "../router";
import { CheckForm } from "./CheckPage";

// The public landing page, in three skies: a bright day sky with the Greenlight app window rising
// out of the clouds (its claims move Queued -> Testing -> Verdict as you scroll), frosted glass
// step cards, and a night sky to close. Buttons, switches, the loader and check marks are adapted
// from Uiverse.io (uiverse.css). Motion stops for viewers who prefer reduced motion.

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

// ------------------------------------------------------------------ the app window in the hero

type Stage = "queued" | "testing" | "pass" | "fail";
const BOARD = [
  { id: "c1", title: "Add to cart", text: "Visitors can add a product to the cart and the count goes up.", ok: true },
  { id: "c2", title: "Cart total", text: "The cart shows the total of the items in it.", ok: true },
  { id: "c3", title: "Password reset", text: "Users can reset their password from the sign-in page.", ok: false },
];
/** Where each claim is at a given scroll step (0..6). */
function stageOf(i: number, step: number, ok: boolean): Stage {
  const start = i * 2 + 1;
  if (step < start) return "queued";
  if (step === start) return "testing";
  return ok ? "pass" : "fail";
}

function ClaimCard({ c, stage }: { c: (typeof BOARD)[number]; stage: Stage }) {
  return (
    <motion.div layout layoutId={c.id} transition={{ type: "spring", stiffness: 260, damping: 30 }} className={`bcard ${stage}`}>
      <b>{c.title}</b>
      <p>{c.text}</p>
      <div className="bcard-foot">
        {stage === "testing" ? (
          <span className="bchip run">
            <span className="dash-loader small" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            Kane is testing
          </span>
        ) : stage === "queued" ? (
          <>
            <span className="bchip">Approved</span>
            <span className="bchip">~37 credits</span>
          </>
        ) : (
          <>
            <span className={`bchip ${stage}`}>
              <span className={`uv-check on ${stage === "fail" ? "fail" : ""}`} aria-hidden="true" />
              {stage === "pass" ? "Passed" : "Failed"}
            </span>
            <span className="bchip">{stage === "pass" ? "View evidence" : "See the fix"}</span>
          </>
        )}
      </div>
    </motion.div>
  );
}

function AppWindow() {
  const ref = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end 0.75"] });
  const [step, setStep] = useState(still ? 6 : 0);
  useEffect(() => {
    if (still) return;
    return scrollYProgress.on("change", (v) => setStep(Math.max(0, Math.min(6, Math.floor((v - 0.35) / 0.08)))));
  }, [scrollYProgress, still]);
  const cols: { key: string; title: string; icon: string; match: (s: Stage) => boolean }[] = [
    { key: "queued", title: "Queued", icon: "q", match: (s) => s === "queued" },
    { key: "testing", title: "Testing", icon: "t", match: (s) => s === "testing" },
    { key: "verdict", title: "Verdict", icon: "v", match: (s) => s === "pass" || s === "fail" },
  ];
  const stages = BOARD.map((c, i) => stageOf(i, step, c.ok));
  const passed = stages.filter((s) => s === "pass").length;
  return (
    <div className="appwin-wrap" ref={ref}>
      <div className="appwin" role="img" aria-label="The Greenlight app: claims move from Queued to Testing to a verdict; two pass, one fails.">
        <aside className="aw-side">
          <div className="aw-brand">
            <Logo size={20} />
            Greenlight
          </div>
          <span className="aw-item on">
            <i className="ic ic-check" /> Checks <em>3</em>
          </span>
          <span className="aw-item">
            <i className="ic ic-act" /> Activity
          </span>
          <span className="aw-group">Main</span>
          <span className="aw-item">
            <i className="ic ic-grid" /> Overview
          </span>
          <span className="aw-item">
            <i className="ic ic-list" /> Claims
          </span>
          <span className="aw-item">
            <i className="ic ic-doc" /> Evidence
          </span>
          <span className="aw-item">
            <i className="ic ic-fix" /> Fixes
          </span>
          <span className="aw-group">Records</span>
          <span className="aw-item">
            <i className="ic ic-hist" /> History
          </span>
        </aside>
        <div className="aw-main">
          <div className="aw-top">
            <span className="aw-search">acme/shop · shop.example.com</span>
            <span className="aw-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
          <div className="aw-head">
            <div>
              <h3>Claims</h3>
              <span className="aw-filter">
                {passed} of {BOARD.length} passed · 94 credits approved
              </span>
            </div>
            <span className="aw-btn">‹ Run again</span>
          </div>
          <LayoutGroup>
            <div className="board">
              {cols.map((col) => (
                <div key={col.key} className="bcol">
                  <div className="bcol-head">
                    <span className={`bico ${col.icon}`} aria-hidden="true" />
                    {col.title}
                  </div>
                  {BOARD.map((c, i) => (col.match(stages[i]!) ? <ClaimCard key={c.id} c={c} stage={stages[i]!} /> : null))}
                  <span className="bcol-add">+ Add claim</span>
                </div>
              ))}
            </div>
          </LayoutGroup>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ glass step cards

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
    <div className="g-mini" ref={ref}>
      {phase === 0 ? (
        <span className="g-run">
          <span className="dash-loader" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          Kane is testing…
        </span>
      ) : (
        ["Add to cart works", "Cart shows the total", "Password reset works"].map((t, i) => (
          <span key={t} className="g-line">
            <span className={`uv-check ${phase > i ? "on" : ""} ${i === 2 ? "fail" : ""}`} aria-hidden="true" />
            {t}
            <b className={i === 2 ? "f" : "p"}>{phase > i ? (i === 2 ? "Failed" : "Passed") : ""}</b>
          </span>
        ))
      )}
    </div>
  );
}

function MiniApprove() {
  const [on, setOn] = useState([true, true, false]);
  const n = on.filter(Boolean).length;
  const labels = ["Add to cart works", "Cart shows the total", "Order email arrives"];
  return (
    <div className="g-mini">
      {labels.map((t, i) => (
        <span key={t} className="g-line">
          <label className="uv-switch small">
            <input type="checkbox" checked={on[i]} onChange={() => setOn((o) => o.map((x, j) => (j === i ? !x : x)))} aria-label={`Test “${t}”`} />
            <span className="switch-track" aria-hidden="true">
              <span className="switch-inner" />
              <span className="switch-knob" />
            </span>
          </label>
          {t}
        </span>
      ))}
      <span className="g-cost">
        {n} claim{n === 1 ? "" : "s"} <b>{n ? 20 + n * 37 : 0} credits</b>
      </span>
    </div>
  );
}

function GlassStep({ n, of, label, title, text, cta, time, next, children, go, variant = "stack" }: { n: number; of: number; label: string; title: ReactNode; text: string; cta: string; time: string; next: string; children?: ReactNode; go: () => void; variant?: "stack" | "plain" }) {
  return (
    <div className={`gcard ${variant}`}>
      {variant === "stack" ? (
        <div className="gcard-top">
          <span className="ring" style={{ ["--p" as string]: `${Math.round((n / of) * 100)}%` }} aria-hidden="true" />
          Step {n} of {of}
          <span className="sp" />
          {Math.round((n / of) * 100)}%
        </div>
      ) : null}
      <div className="gcard-body">
        <span className="gcard-k">{label}</span>
        <h3>{title}</h3>
        <p>{text}</p>
        {children}
        <div className="gcard-cta">
          <button type="button" className={`pill-dark ${variant === "plain" ? "wide" : ""}`} onClick={go}>
            {variant === "stack" ? <span className="pill-ic" aria-hidden="true">▶</span> : null}
            {cta}
            {variant === "plain" ? <span className="pill-time">{time}</span> : null}
          </button>
          {variant === "stack" ? <span className="gtime">◷ {time}</span> : null}
        </div>
      </div>
      <div className="gcard-next">
        <span>Coming next</span>
        {next}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ page

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
  const cloudL = useTransform(heroP, [0, 1], still ? [0, 0] : [0, -160]);
  const cloudR = useTransform(heroP, [0, 1], still ? [0, 0] : [0, -90]);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  useEffect(() => {
    document.title = "Greenlight · Does your app do what its README says?";
  }, []);

  return (
    <div className="land">
      <header className="topbar-land">
        <a href="/app" className="brand">
          <Logo size={24} />
          <span className="brand-name">Greenlight</span>
        </a>
        <nav className="tl-links" aria-label="Main">
          <a href="#how" onClick={(e) => (e.preventDefault(), go("how"))}>
            How it works
          </a>
          <a href="#verdicts" onClick={(e) => (e.preventDefault(), go("verdicts"))}>
            Verdicts
          </a>
          <a href="#check" onClick={(e) => (e.preventDefault(), go("check"))}>
            Check an app
          </a>
        </nav>
        <span className="tl-right">
          {googleUrl ? (
            <a className="btn-outline" href={googleUrl}>
              Sign in
            </a>
          ) : null}
          <button type="button" className="btn-blue" onClick={() => go("check")}>
            Check my app
          </button>
        </span>
      </header>

      <main id="main">
        <section className="day" ref={heroRef} aria-labelledby="hero-h">
          <span className="frame-line" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <motion.div className="cloud-wrap cl-1" style={{ y: cloudR }}>
            <Cloud seed={4} />
          </motion.div>
          <motion.div className="cloud-wrap cl-2" style={{ y: cloudL }}>
            <Cloud seed={9} />
          </motion.div>
          <motion.div className="cloud-wrap cl-3" style={{ y: cloudR }}>
            <Cloud seed={13} />
          </motion.div>

          <div className="day-copy">
            <motion.span className="tag" initial={still ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease }}>
              less guessing, more proof.
            </motion.span>
            <motion.h1 id="hero-h" initial={still ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease, delay: 0.05 }}>
              Your README makes <span className="soft">promises.</span>
              <br />
              Kane checks <span className="soft">them.</span>
            </motion.h1>
            <motion.p initial={still ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.2 }}>
              Paste a GitHub repo and its live URL. Kane tests every claim in your README on the deployed app, in a real browser, and tells you what passed and what to fix.
            </motion.p>
            <motion.div className="day-cta" initial={still ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.3 }}>
              <span className="cta-main">
                <button type="button" className="uv-button" onClick={() => go("check")}>
                  Check my app
                </button>
                <span className="scrawl" aria-hidden="true">
                  <svg viewBox="0 0 60 40">
                    <path d="M8 4 C 4 18, 12 30, 34 32" fill="none" stroke="#1b2a3f" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="M28 27 L 35 32 L 28 36" fill="none" stroke="#1b2a3f" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  it’s free
                </span>
              </span>
              <button type="button" className="btn-glass" onClick={() => go("how")}>
                <span aria-hidden="true">▶</span> See how it works
              </button>
            </motion.div>
          </div>

          <AppWindow />
          <CloudBank className="bank-day" seed={7} />
          <div className="built">
            <span>Built with</span>
            <div className="built-row">
              <b>Kane CLI</b>
              <b>TestMu AI</b>
              <b>Vercel</b>
              <b>Supabase</b>
              <b>React</b>
            </div>
          </div>
        </section>

        <section className="glass-sec" id="how" aria-labelledby="how-h">
          <Reveal className="sec-head">
            <span className="tag dark">How it works</span>
            <h2 id="how-h">
              Three steps to an <span className="soft">honest</span> answer
            </h2>
          </Reveal>
          <div className="gcards">
            <Reveal>
              <GlassStep n={1} of={3} label="Paste" title={<>Your repo, the live URL, your README</>} text="Every bullet point in your README becomes a claim. Edit them, drop some, add your own." cta="Start a check" time="1 min" next="Approve the cost" go={() => go("check")} />
            </Reveal>
            <Reveal delay={0.08}>
              <GlassStep n={2} of={3} label="Approve" title={<>Pick the claims, see the cost</>} text="Switch claims on or off. Clicking Run approves exactly these tests and this cost, nothing more." cta="Try the switches" time="94 credits" next="Kane runs the tests" go={() => go("check")}>
                <MiniApprove />
              </GlassStep>
            </Reveal>
            <Reveal delay={0.16}>
              <GlassStep variant="plain" n={3} of={3} label="Verdict" title={<>Passed or failed, claim by claim</>} text="Kane uses your live app in a real browser. Each failure comes with what it saw and a fix." cta="Get a verdict" time="a few minutes" next="Fix it and check again" go={() => go("check")}>
                <MiniRun />
              </GlassStep>
            </Reveal>
          </div>

          <div className="verdict-row" id="verdicts">
            <Reveal className="vglass p">
              <span className="uv-check on" aria-hidden="true" />
              <b>Passed</b>
              <span>Kane did what the claim says on your live app, and it worked.</span>
            </Reveal>
            <Reveal className="vglass f" delay={0.08}>
              <span className="uv-check on fail" aria-hidden="true" />
              <b>Failed</b>
              <span>It didn’t work. You get what Kane saw and a suggested fix.</span>
            </Reveal>
            <Reveal className="vglass u" delay={0.16}>
              <span className="result-mark unknown" aria-hidden="true" />
              <b>Could not verify</b>
              <span>Kane can’t check it from a browser, so it says so instead of guessing.</span>
            </Reveal>
          </div>
        </section>

        <section className="check-sec" id="check" aria-labelledby="check-h">
          <Reveal className="sec-head center">
            <span className="tag dark">Check an app</span>
            <h2 id="check-h">
              Does your app do what its README <span className="soft">says?</span>
            </h2>
            <p>One free run, up to two claims. No account needed. You see the cost before anything runs.</p>
          </Reveal>
          <Reveal className="check-glass" delay={0.1}>
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

        <section className="night" aria-labelledby="night-h">
          <Stars />
          <div className="night-copy">
            <h2 id="night-h">
              Get the green light in <span className="lit">minutes</span>
              <svg className="sparkle" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 1 C 12.6 8, 16 11.4, 23 12 C 16 12.6, 12.6 16, 12 23 C 11.4 16, 8 12.6, 1 12 C 8 11.4, 11.4 8, 12 1 Z" fill="none" stroke="#fff" strokeWidth="1.2" />
              </svg>
            </h2>
            <p>Paste a repo and a live URL. Your first verdict arrives in minutes. No sign-up, no setup.</p>
            <div className="night-cta">
              <button type="button" className="btn-night" onClick={() => go("check")}>
                Check my app
              </button>
              <button type="button" className="btn-night icon" onClick={() => go("how")}>
                <span className="kbd" aria-hidden="true">
                  ⏵
                </span>
                How it works
              </button>
            </div>
          </div>
          <CloudBank className="bank-night" seed={21} />
          <footer className="foot-sky">
            <span className="brand">
              <Logo size={22} />
              <span className="brand-name">Greenlight</span>
            </span>
            <span className="foot-links">
              {googleUrl ? <a href={googleUrl}>Sign in with Google</a> : null}
              <a href={ADMIN_LOGIN}>Administrator sign-in</a>
              <a href="https://uiverse.io" rel="noopener">
                UI elements from Uiverse.io
              </a>
            </span>
          </footer>
        </section>
      </main>
    </div>
  );
}
