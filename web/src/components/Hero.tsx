import { useEffect, useState, type ReactNode } from "react";

// Landing-page pieces. The hero is a working picture of the product: a browser on a sample shop
// where Kane's cursor clicks through two claims while the run log fills in, then a third claim
// fails. It loops. Viewers who prefer reduced motion see the finished run, still.

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const LAST = 9;

type Line = { at: number; t: string; text: ReactNode; kind?: "pass" | "fail" };
const LOG: Line[] = [
  { at: 1, t: "00:01", text: <>open <u>shop.example.com</u></> },
  { at: 3, t: "00:03", text: <>click button “Add to cart”</> },
  { at: 4, t: "00:04", text: <>cart badge shows 1</>, kind: "pass" },
  { at: 6, t: "00:06", text: <>click cart · drawer opens</> },
  { at: 7, t: "00:07", text: <>total is visible · $24.00</>, kind: "pass" },
  { at: 8, t: "00:09", text: <>open /reset-password · 404</>, kind: "fail" },
];

const CLAIMS: { at: number; text: string; ok: boolean }[] = [
  { at: 4, text: "Visitors can add a product to the cart", ok: true },
  { at: 7, text: "The cart shows the total", ok: true },
  { at: 8, text: "Users can reset their password", ok: false },
];

function useRunStep() {
  const [step, setStep] = useState(() => (reduced() ? LAST : 0));
  useEffect(() => {
    if (reduced()) return;
    const t = setInterval(() => setStep((s) => (s >= LAST + 4 ? 0 : s + 1)), 950);
    return () => clearInterval(t);
  }, []);
  return Math.min(step, LAST);
}

function Cursor({ step }: { step: number }) {
  const at = step >= 5 ? "cart" : step >= 2 ? "add" : "rest";
  const pressing = step === 3 || step === 6;
  return (
    <span className={`kane-cursor at-${at} ${pressing ? "press" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 20 20" width="20" height="20">
        <path d="M3 2l13 7.2-5.6 1.4L8 16z" fill="#fff" stroke="#0b0b0c" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <span className="cursor-tag">Kane</span>
    </span>
  );
}

const PRODUCTS = [
  { name: "Stoneware mug", price: "$24.00", shape: "mug" },
  { name: "Linen tote", price: "$38.00", shape: "tote" },
  { name: "Desk lamp", price: "$89.00", shape: "lamp" },
];

function ProductArt({ shape }: { shape: string }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (shape === "mug")
    return (
      <svg viewBox="0 0 60 48" aria-hidden="true">
        <path d="M14 12h26v22a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6z" {...s} />
        <path d="M40 18h4a5 5 0 0 1 0 10h-4" {...s} />
        <path d="M22 6c0 2 2 2 2 4M30 6c0 2 2 2 2 4" {...s} opacity="0.5" />
      </svg>
    );
  if (shape === "tote")
    return (
      <svg viewBox="0 0 60 48" aria-hidden="true">
        <path d="M14 18h32l-3 24H17z" {...s} />
        <path d="M22 18c0-8 16-8 16 0" {...s} />
      </svg>
    );
  return (
    <svg viewBox="0 0 60 48" aria-hidden="true">
      <path d="M20 42h20M30 42V24l-8-12" {...s} />
      <path d="M16 8l12 4-4 10z" {...s} />
    </svg>
  );
}

export function RunDemo() {
  const step = useRunStep();
  const inCart = step >= 3 ? 1 : 0;
  const passed = CLAIMS.filter((c) => step >= c.at && c.ok).length;
  const done = step >= LAST;
  return (
    <div className="demo" role="img" aria-label="Kane testing a sample shop in a real browser: two claims pass, one fails.">
      <div className="win">
        <div className="win-bar">
          <span className="lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="url">
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
              <path d="M3.5 5V3.8a2.5 2.5 0 0 1 5 0V5M2.8 5h6.4v4.5H2.8z" fill="none" stroke="currentColor" strokeWidth="1.1" />
            </svg>
            shop.example.com
          </span>
          <span className={`rec ${done ? "off" : ""}`}>{done ? "Run finished" : "Kane · testing"}</span>
        </div>
        <div className="site">
          <div className="site-head">
            <b>Northwind Goods</b>
            <span className="site-nav">Shop · About</span>
            <span className={`cart ${step === 6 ? "hit" : ""}`}>
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                <path d="M3 4h2l1.6 8.2a1.5 1.5 0 0 0 1.5 1.2h6.3a1.5 1.5 0 0 0 1.5-1.2L17 7H6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              <span className={`badge ${inCart ? "on" : ""}`}>{inCart}</span>
            </span>
          </div>
          <div className="products">
            {PRODUCTS.map((p, i) => (
              <div key={p.name} className="product">
                <div className={`p-art p${i}`}>
                  <ProductArt shape={p.shape} />
                </div>
                <span className="p-name">{p.name}</span>
                <span className="p-price">{p.price}</span>
                <span className={`p-add ${i === 0 && step === 3 ? "pressed" : ""} ${i === 0 && inCart ? "added" : ""}`}>{i === 0 && inCart ? "Added ✓" : "Add to cart"}</span>
              </div>
            ))}
          </div>
          <div className={`drawer ${step >= 6 ? "open" : ""}`}>
            <span className="d-head">Your cart</span>
            <span className="d-row">
              Stoneware mug <b>$24.00</b>
            </span>
            <span className="d-total">
              Total <b>$24.00</b>
            </span>
          </div>
          <Cursor step={step} />
        </div>
      </div>

      <div className="runlog">
        <div className="runlog-head">
          <span>Run log</span>
          <span className="mono">acme/shop · main</span>
        </div>
        <ol className="lines">
          {LOG.map((l) => (
            <li key={l.t} className={`${step >= l.at ? "in" : ""} ${l.kind ?? ""}`}>
              <span className="t">{l.t}</span>
              <span className="mark" aria-hidden="true">
                {l.kind === "pass" ? "✓" : l.kind === "fail" ? "✕" : "›"}
              </span>
              <span>{l.text}</span>
            </li>
          ))}
        </ol>
        <div className="claims">
          {CLAIMS.map((c) => {
            const state = step < c.at ? "wait" : c.ok ? "pass" : "fail";
            return (
              <div key={c.text} className={`claim ${state}`}>
                <span className="c-dot" aria-hidden="true" />
                <span className="c-text">{c.text}</span>
                <span className="c-state">{state === "wait" ? "Queued" : state === "pass" ? "Passed" : "Failed"}</span>
              </div>
            );
          })}
        </div>
        <div className="runlog-foot">
          <span>
            {passed}/{CLAIMS.length} passed
          </span>
          <span className="mono">94 credits · approved</span>
        </div>
      </div>
    </div>
  );
}

/** A README with Kane's results written into the margin. */
export function AnnotatedReadme() {
  return (
    <div className="annot">
      <div className="doc">
        <div className="doc-bar">
          <span className="mono">README.md</span>
          <span className="mono dim">acme/shop</span>
        </div>
        <div className="md">
          <h3># Northwind Goods</h3>
          <p>A small shop for everyday things, built with Next.js.</p>
          <h4>## Features</h4>
          <ul>
            <li className="hl pass">
              <span>Visitors can add a product to the cart</span>
              <em>Passed</em>
            </li>
            <li className="hl pass">
              <span>The cart shows the total</span>
              <em>Passed</em>
            </li>
            <li className="hl fail">
              <span>Users can reset their password</span>
              <em>Failed</em>
            </li>
            <li className="hl wait">
              <span>Orders arrive by email within a minute</span>
              <em>Could not verify</em>
            </li>
          </ul>
        </div>
      </div>
      <div className="notes">
        <div className="note fail">
          <span className="note-k">Failed · what Kane saw</span>
          <p>The “Forgot password?” link opens /reset-password, which returns a 404 page.</p>
          <span className="note-k">Suggested fix</span>
          <pre className="diff">
            <span className="del">- Users can reset their password</span>
            {"\n"}
            <span className="add">+ app/reset-password/page.tsx  (add the route)</span>
          </pre>
        </div>
        <div className="note wait">
          <span className="note-k">Could not verify</span>
          <p>Kane can’t read your inbox, so this one is neither confirmed nor disproved. Nothing is guessed.</p>
        </div>
      </div>
    </div>
  );
}

export function StepsList() {
  const steps = [
    { n: "01", title: "Paste", text: "Your GitHub repo, the live URL and, if you like, your README. Every bullet point becomes a claim you can edit or drop." },
    { n: "02", title: "Approve", text: "You see each claim and the exact credit cost. Clicking Run approves exactly that, nothing more." },
    { n: "03", title: "Read the verdict", text: "Kane uses the live app in a real browser. Each claim passes, fails or can’t be verified, with what it saw and a fix." },
  ];
  return (
    <ol className="steps-list">
      {steps.map((s) => (
        <li key={s.n}>
          <span className="s-n">{s.n}</span>
          <h3>{s.title}</h3>
          <p>{s.text}</p>
        </li>
      ))}
    </ol>
  );
}
