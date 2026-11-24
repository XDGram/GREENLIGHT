// "How it works" illustration: README -> Kane tests the live app -> verdict -> Claude Code fixes,
// and the loop back to Kane for the re-check. Plain SVG, scales with its container.

const INK = "#0b1437";
const LINE = "#dbe3f3";
const SOFT = "#eef3fc";
const GREEN = "#16a34a";
const BLUE = "#2563eb";
const LIME = "#d9f24a";
const RED = "#dc2626";

function Panel({ x, title, children }: { x: number; title: string; children: React.ReactNode }) {
  return (
    <g transform={`translate(${x} 20)`}>
      <rect width="200" height="168" rx="16" fill="#fff" stroke={LINE} />
      <rect x="0.5" y="0.5" width="199" height="30" rx="15.5" fill={SOFT} />
      <rect x="0.5" y="16" width="199" height="15" fill={SOFT} />
      <line x1="0" y1="31" x2="200" y2="31" stroke={LINE} />
      <circle cx="16" cy="16" r="3.5" fill={LINE} />
      <circle cx="28" cy="16" r="3.5" fill={LINE} />
      <circle cx="40" cy="16" r="3.5" fill={LINE} />
      <text x="186" y="20" textAnchor="end" fontSize="10.5" fontFamily="Geist Mono, monospace" fill="#5a6580">
        {title}
      </text>
      {children}
    </g>
  );
}

function Arrow({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 104)`}>
      <line x1="0" y1="0" x2="34" y2="0" stroke={INK} strokeWidth="1.6" />
      <path d="M28 -5 L35 0 L28 5" fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
    </g>
  );
}

export function LoopIllustration() {
  return (
    <svg className="lp-loop" viewBox="0 0 1000 300" role="img" aria-label="Paste your README, Kane tests each claim on the live app, you get a verdict, Claude Code fixes what failed and Kane checks again.">
      {/* 1. README */}
      <Panel x={20} title="README.md">
        {[56, 84, 112, 140].map((y, i) => (
          <g key={y}>
            <circle cx="22" cy={y} r="3" fill={INK} />
            <rect x="34" y={y - 4} width={[132, 112, 140, 96][i]} height="8" rx="4" fill={SOFT} />
          </g>
        ))}
      </Panel>
      <Arrow x={228} />

      {/* 2. Kane in a real browser */}
      <Panel x={270} title="kane · live app">
        <rect x="16" y="44" width="168" height="14" rx="7" fill={SOFT} />
        <rect x="16" y="70" width="80" height="60" rx="8" fill={SOFT} />
        <rect x="104" y="70" width="80" height="26" rx="6" fill={SOFT} />
        <rect x="104" y="104" width="80" height="26" rx="13" fill={INK} />
        <path d="M150 112 L150 142 L157 135 L163 147 L168 144 L162 132 L171 132 Z" fill="#fff" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
        <text x="16" y="154" fontSize="10" fontFamily="Geist Mono, monospace" fill="#5a6580">
          clicking, typing, checking
        </text>
      </Panel>
      <Arrow x={478} />

      {/* 3. Verdict */}
      <Panel x={520} title="verdict">
        <g transform="translate(16 46)">
          <rect width="168" height="40" rx="10" fill="#f0fbf3" stroke="#bfe8cc" />
          <circle cx="20" cy="20" r="10" fill={GREEN} />
          <path d="M15 20 L19 24 L26 16" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="40" y="16" width="104" height="8" rx="4" fill="#cfeedd" />
        </g>
        <g transform="translate(16 94)">
          <rect width="168" height="40" rx="10" fill="#fff5f5" stroke="#f6cccc" />
          <circle cx="20" cy="20" r="10" fill={RED} />
          <path d="M16 16 L24 24 M24 16 L16 24" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          <rect x="40" y="16" width="88" height="8" rx="4" fill="#f9dcdc" />
        </g>
        <text x="16" y="154" fontSize="10" fontFamily="Geist Mono, monospace" fill="#5a6580">
          + what Kane saw
        </text>
      </Panel>
      <Arrow x={728} />

      {/* 4. Claude Code fixes */}
      <g transform="translate(770 20)">
        <rect width="200" height="168" rx="16" fill={INK} />
        <text x="16" y="22" fontSize="10.5" fontFamily="Geist Mono, monospace" fill="#93a4cf">
          claude code
        </text>
        <line x1="0" y1="31" x2="200" y2="31" stroke="#1e2a55" />
        {[
          ["›", "read Kane's verdict", "#c7d6f7"],
          ["✎", "fix app.js", "#c7d6f7"],
          ["↑", "commit · push", "#c7d6f7"],
          ["⟳", "ask Kane to re-check", LIME],
        ].map(([g, t, c], i) => (
          <text key={t} x="16" y={58 + i * 26} fontSize="12" fontFamily="Geist Mono, monospace" fill={c}>
            {g} {t}
          </text>
        ))}
      </g>

      {/* The loop back to Kane */}
      <path d="M870 190 C 870 268, 370 268, 370 196" fill="none" stroke={BLUE} strokeWidth="1.8" strokeDasharray="5 6" />
      <path d="M364 203 L370 194 L376 203" fill="none" stroke={BLUE} strokeWidth="1.8" strokeLinejoin="round" />
      <rect x="548" y="238" width="104" height="26" rx="13" fill={LIME} />
      <text x="600" y="255" textAnchor="middle" fontSize="11.5" fontWeight="600" fontFamily="Geist Sans, Geist, sans-serif" fill={INK}>
        until it passes
      </text>
    </svg>
  );
}
