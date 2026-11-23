import { Logo, TrafficLight } from "./Chrome";

// Landing-page pieces: green light streaks for dark panels, a flow diagram of one check, honest
// fact cards and glowing feature cells. All motion stops when the viewer prefers reduced motion
// (handled in theme.css). Everything is CSS and inline SVG: the CSP allows no data: URIs.

/** Vertical streaks of green light, brightest at the edges, like light through glass. */
export function Streaks({ tone = "go" }: { tone?: "go" | "stop" | "wait" }) {
  return (
    <span className={`streaks ${tone}`} aria-hidden="true">
      <span className="streaks-glow" />
    </span>
  );
}

const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** One check, drawn as a flow: repo and URL in, Kane in the middle, verdict and fixes out. */
export function Flow() {
  return (
    <div className="flow" role="img" aria-label="Your repository, live URL and README go to Kane, which tests the live app and returns a verdict with suggested fixes.">
      <div className="flow-node top">GitHub repo + live URL</div>
      <span className="flow-arrow down" aria-hidden="true" />
      <div className="flow-row">
        <div className="flow-card">
          <div className="mini">
            <span className="mini-head">README.md</span>
            <span className="mini-line">- Users can sign up with email</span>
            <span className="mini-line">- The dashboard shows tasks</span>
            <span className="mini-line">- Export a report as CSV</span>
          </div>
          <b>Your README</b>
          <span>Each bullet becomes a claim</span>
        </div>
        <span className="flow-link" aria-hidden="true" />
        <div className="flow-core">
          <span className="core-glow" aria-hidden="true" />
          <Logo size={40} />
          <b>Kane tests the live app</b>
          <span>Real browser · one claim at a time</span>
        </div>
        <span className="flow-link" aria-hidden="true" />
        <div className="flow-card">
          <div className="mini verdict-mini">
            <TrafficLight lit="green" />
            <div>
              <span className="mini-head">Verdict</span>
              <span className="mini-pass">Passed</span>
              <span className="mini-line">3 of 3 claims</span>
            </div>
          </div>
          <b>Your verdict</b>
          <span className="go-text">Passed · Failed · Could not verify</span>
        </div>
      </div>
      <span className="flow-arrow down" aria-hidden="true" />
      <div className="flow-node bottom">A suggested fix for anything that fails</div>
    </div>
  );
}

export function Facts() {
  const items = [
    { big: "0", unit: "", text: "Sign-ups needed. Your browser remembers your checks." },
    { big: "1", unit: "free run", text: "For every visitor, up to two claims." },
    { big: "~37", unit: "credits", text: "Per claim, and the exact cost is shown before you run." },
    { big: "3", unit: "outcomes", text: "Passed, Failed or Could not verify. Never a guess." },
  ];
  return (
    <div className="facts">
      {items.map((f) => (
        <div key={f.text} className="fact">
          <div className="fact-big">
            {f.big}
            {f.unit ? <small>{f.unit}</small> : null}
          </div>
          <p>{f.text}</p>
        </div>
      ))}
    </div>
  );
}

const ICONS = {
  browser: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="6" width="24" height="20" rx="4" {...line} />
      <path d="M4 12h24" {...line} />
      <path d="M12 19l3 3 6-6" {...line} />
    </svg>
  ),
  approve: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 4l10 4v7c0 6.5-4.3 11-10 13-5.7-2-10-6.5-10-13V8z" {...line} />
      <path d="M11.5 16l3 3 6-6.5" {...line} />
    </svg>
  ),
  claims: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 9l2 2 4-4M8 17l2 2 4-4M8 25l2 2 4-4" {...line} />
      <path d="M18 9h8M18 17h8M18 25h8" {...line} />
    </svg>
  ),
  fix: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M19.5 5.5a6 6 0 0 0-7.6 7.6L5 20l7 7 6.9-6.9a6 6 0 0 0 7.6-7.6L22.5 16.5l-4-1-1-4z" {...line} />
    </svg>
  ),
};

export function Pillars() {
  const items: { icon: keyof typeof ICONS; title: string; text: string }[] = [
    { icon: "browser", title: "A real browser", text: "Kane uses your deployed app the way a visitor would. No mocks." },
    { icon: "approve", title: "You approve first", text: "Clicking Run approves exactly these claims and this cost. Nothing else." },
    { icon: "claims", title: "Claim by claim", text: "Each claim gets its own result and what Kane saw on the page." },
    { icon: "fix", title: "Fixes, not just failures", text: "Every failed claim comes with a suggested fix to try before you check again." },
  ];
  return (
    <div className="pillars">
      {items.map((p) => (
        <div key={p.title} className="pillar">
          <span className="pillar-icon">{ICONS[p.icon]}</span>
          <h3>{p.title}</h3>
          <p>{p.text}</p>
        </div>
      ))}
    </div>
  );
}
