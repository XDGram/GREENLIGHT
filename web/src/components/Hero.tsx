import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Logo } from "./Chrome";

// Landing-page pieces in the "terminal grid" style: a dark band of green pixels, a ticker, a
// typed bracket word, a dotted flow strip and numbered value cells. All decorative motion stops
// when the viewer prefers reduced motion.

const COLS = 24;
const ROWS = 6;

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A deterministic sweep of lit cells, brighter toward a diagonal, like a signal turning green. */
function cells(seed: number) {
  const out: number[] = [];
  let x = seed;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      x = (x * 9301 + 49297) % 233280;
      const rnd = x / 233280;
      const band = 1 - Math.min(1, Math.abs(c / COLS - (0.25 + r / ROWS / 1.6)) * 3.2);
      const v = rnd * 0.55 + band * 0.75 - 0.42;
      out.push(v > 0.55 ? 3 : v > 0.32 ? 2 : v > 0.14 ? 1 : 0);
    }
  }
  return out;
}
const SHADE = ["transparent", "#0f2a1b", "#0f6b38", "var(--green)"];

export function PixelHero({ nav, right }: { nav?: ReactNode; right?: ReactNode }) {
  const [seed, setSeed] = useState(7);
  useEffect(() => {
    if (reduced()) return;
    const t = setInterval(() => setSeed((s) => (s % 9) + 1), 2600);
    return () => clearInterval(t);
  }, []);
  const lit = useMemo(() => cells(seed), [seed]);
  return (
    <header className="hero">
      <div className="hero-grid" style={{ ["--cols" as string]: COLS, ["--rows" as string]: ROWS } as React.CSSProperties} aria-hidden="true">
        {lit.map((v, i) => (
          <span key={i} style={{ background: SHADE[v] }} />
        ))}
      </div>
      <div className="hero-inner">
        <div className="hero-top">
          {nav}
          <span style={{ marginLeft: "auto" }}>{right}</span>
        </div>
        <div className="hero-brand">
          <Logo size={26} />
          <span className="brand-name">Greenlight</span>
          <span className="brand-tag">V1.0 · KANE</span>
          <span className="hero-scroll">Scroll to check +</span>
        </div>
      </div>
      <Ticker items={["Introducing: README claims tested by Kane", "Real browser · live app", "Verdict per claim", "Suggested fixes for every failure"]} />
    </header>
  );
}

export function Ticker({ items }: { items: string[] }) {
  const row = [...items, ...items, ...items];
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {[...row, ...row].map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}

/** A word typed into brackets with a blinking block cursor: [ README█ ] */
export function TypedBracket({ words }: { words: string[] }) {
  const [text, setText] = useState(words[0] ?? "");
  useEffect(() => {
    if (reduced()) return;
    let w = 0;
    let n = words[0]!.length;
    let deleting = false;
    let hold = 20;
    const t = setInterval(() => {
      if (hold > 0) {
        hold -= 1;
        return;
      }
      const word = words[w]!;
      if (!deleting) {
        if (n < word.length) n += 1;
        else {
          deleting = true;
          hold = 20;
          return;
        }
      } else if (n > 0) n -= 1;
      else {
        deleting = false;
        w = (w + 1) % words.length;
        hold = 3;
        return;
      }
      setText(words[w]!.slice(0, n));
    }, 90);
    return () => clearInterval(t);
  }, [words]);
  return (
    <span className="bracket">
      [ {text}
      <span className="cursor" aria-hidden="true" /> ]
    </span>
  );
}

export function FlowStrip() {
  return (
    <div className="strip" aria-label="Paste, Kane tests, verdict">
      <span className="edge" aria-hidden="true">
        ···
      </span>
      <span aria-hidden="true">&gt;</span>
      <span className="flow">
        Paste <em>→</em> Kane tests <em>→</em> Verdict <em>→</em> Fix
      </span>
      <span aria-hidden="true">&lt;</span>
      <span className="edge" aria-hidden="true">
        ···
      </span>
    </div>
  );
}

const ICONS: Record<string, string[]> = {
  paste: ["00111100", "01000010", "01111110", "01000010", "01000010", "01000010", "01111110", "00000000"],
  browser: ["11111111", "10000001", "11111111", "10000001", "10011001", "10000001", "11111111", "00000000"],
  verdict: ["00000000", "00000011", "00000110", "11001100", "01111000", "00110000", "00000000", "00000000"],
};

function PixelIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <span className="pixel-icon" aria-hidden="true">
      {ICONS[name]!.join("").split("").map((b, i) => (
        <span key={i} className={b === "1" ? "on" : ""} />
      ))}
    </span>
  );
}

export function ValueCells() {
  const items: { n: string; icon: keyof typeof ICONS; title: string; text: string; on?: boolean }[] = [
    { n: "001", icon: "paste", title: "Paste your README", text: "Each bullet point becomes a claim. Edit them, drop some, add your own." },
    { n: "002", icon: "browser", title: "Kane tests the live app", text: "A real browser uses your deployed app the way a visitor would, one claim at a time.", on: true },
    { n: "003", icon: "verdict", title: "Verdict and fixes", text: "Passed or failed for each claim, what Kane saw, and what to fix before you check again." },
  ];
  return (
    <div className="cells">
      {items.map((c) => (
        <div key={c.n} className={`cell ${c.on ? "on" : ""}`}>
          <div className="cell-head">
            <PixelIcon name={c.icon} />
            <span className="num-tag">{c.n}</span>
          </div>
          <h3 style={{ marginTop: "auto" }}>{c.title}</h3>
          <p>{c.text}</p>
        </div>
      ))}
    </div>
  );
}
