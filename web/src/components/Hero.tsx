// Landing-page pieces in the "paper" style: a faint field of dashes behind the hero, a slow strip
// of example claims, and three step cards with thin line drawings. Motion stops when the viewer
// prefers reduced motion (handled in theme.css).

/** Scattered short dashes, drawn once as an inline SVG pattern (no data: URIs under the CSP). */
export function Dashes() {
  const marks: { x: number; y: number; r: number }[] = [];
  let s = 11;
  for (let i = 0; i < 46; i += 1) {
    s = (s * 9301 + 49297) % 233280;
    const x = (s / 233280) * 300;
    s = (s * 9301 + 49297) % 233280;
    const y = (s / 233280) * 300;
    s = (s * 9301 + 49297) % 233280;
    marks.push({ x, y, r: [-35, 0, 35, 70, 90][Math.floor((s / 233280) * 5)]! });
  }
  return (
    <svg className="dashes" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="gl-dashes" width="300" height="300" patternUnits="userSpaceOnUse">
          {marks.map((m, i) => (
            <line key={i} x1={m.x - 3} y1={m.y} x2={m.x + 3} y2={m.y} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" transform={`rotate(${m.r} ${m.x} ${m.y})`} />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#gl-dashes)" />
    </svg>
  );
}

const EXAMPLES = [
  "Users can sign up with email",
  "The dashboard shows your tasks",
  "Search returns matching results",
  "You can export a report as CSV",
  "Dark mode is remembered",
  "Checkout works on mobile",
  "Password reset sends an email",
  "Invite a teammate by link",
];

export function ClaimsStrip() {
  const row = [...EXAMPLES, ...EXAMPLES];
  return (
    <section className="claims-strip" aria-label="Examples of claims Kane can check">
      <p>Claims like these, checked on the live app</p>
      <div className="rail">
        <div className="track">
          {row.map((t, i) => (
            <span key={i} aria-hidden={i >= EXAMPLES.length ? "true" : undefined}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function ArtPaste() {
  return (
    <svg viewBox="0 0 220 150" aria-hidden="true">
      <rect x="20" y="16" width="150" height="104" rx="8" {...line} />
      <path d="M20 34h150" {...line} />
      <circle cx="31" cy="25" r="2" {...line} />
      <circle cx="39" cy="25" r="2" {...line} />
      <path d="M36 52h46M36 66h96M36 78h80M36 90h88M36 102h60" {...line} opacity="0.55" />
      <path d="M30 66l-4 0M30 78h-4M30 90h-4M30 102h-4" {...line} />
      <rect x="128" y="76" width="74" height="58" rx="7" {...line} fill="var(--panel-2)" />
      <path d="M150 76v-6a5 5 0 0 1 5-5h20a5 5 0 0 1 5 5v6" {...line} />
      <path d="M142 96h46M142 108h34M142 120h40" {...line} />
    </svg>
  );
}

function ArtBrowser() {
  return (
    <svg viewBox="0 0 220 150" aria-hidden="true">
      <rect x="16" y="14" width="188" height="122" rx="8" {...line} />
      <path d="M16 32h188" {...line} />
      <rect x="54" y="20" width="112" height="7" rx="3.5" {...line} opacity="0.55" />
      <rect x="34" y="46" width="70" height="10" rx="3" {...line} />
      <rect x="34" y="64" width="70" height="10" rx="3" {...line} />
      <rect x="34" y="84" width="40" height="14" rx="4" {...line} />
      <path d="M124 48h56M124 60h44M124 72h50" {...line} opacity="0.55" />
      <path d="M112 50l2.6 2.6 5-5.6M112 62l2.6 2.6 5-5.6" stroke="var(--green)" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M70 96l0 22 6-6 5 10 4-2-5-10 8 0z" {...line} fill="var(--panel-2)" />
    </svg>
  );
}

function ArtNote() {
  return (
    <svg viewBox="0 0 220 150" aria-hidden="true">
      <path d="M58 12h80l24 24v104H58z" {...line} />
      <path d="M138 12v24h24" {...line} />
      <path d="M72 34h44" {...line} />
      <path d="M72 58l3 3 6-7" stroke="var(--green)" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M88 58h56" {...line} opacity="0.55" />
      <path d="M72 78l3 3 6-7" stroke="var(--green)" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M88 78h46" {...line} opacity="0.55" />
      <path d="M73 95l7 7M80 95l-7 7" {...line} />
      <path d="M88 98h52" {...line} opacity="0.55" />
      <path d="M88 112h40M88 122h48" {...line} opacity="0.35" />
    </svg>
  );
}

export function Steps() {
  const items = [
    { art: <ArtPaste />, title: "1. Paste your repo", text: "Your GitHub link, the live URL and the README.", foot: "Each bullet point becomes a claim you can edit" },
    { art: <ArtBrowser />, title: "2. Kane tests the live app", text: "A real browser uses it the way a visitor would.", foot: "One claim at a time · cost shown before you run" },
    { art: <ArtNote />, title: "3. Read the verdict", text: "Passed or failed, claim by claim, with a fix.", foot: "Passed · Failed · Could not verify" },
  ];
  return (
    <div className="steps">
      {items.map((s) => (
        <article key={s.title} className="step">
          <h3>{s.title}</h3>
          <p>{s.text}</p>
          <div className="art">{s.art}</div>
          <div className="foot">{s.foot}</div>
        </article>
      ))}
    </div>
  );
}
