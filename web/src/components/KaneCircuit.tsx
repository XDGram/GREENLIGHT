/*
 * From Uiverse.io by Vosoone - https://uiverse.io/Vosoone/smooth-penguin-53
 * MIT License, Copyright (c) Vosoone (Vosoone)
 *
 * Adapted for Greenlight: a React component with scoped class names (kc-*) and per-instance
 * gradient ids, and the chip reads "KANE CLI" instead of "Loading". The traces, colours and the
 * flow animation are kept as published (styles/kane-circuit.css).
 */
import { useId } from "react";
import "../styles/kane-circuit.css";

const TRACES: [string, string][] = [
  ["M100 100 H200 V210 H326", "purple"],
  ["M80 180 H180 V230 H326", "blue"],
  ["M60 260 H150 V250 H326", "yellow"],
  ["M100 350 H200 V270 H326", "green"],
  ["M700 90 H560 V210 H474", "blue"],
  ["M740 160 H580 V230 H474", "green"],
  ["M720 250 H590 V250 H474", "red"],
  ["M680 340 H570 V270 H474", "yellow"],
];
const PINS_Y = [205, 225, 245, 265];
const ENDS: [number, number][] = [
  [100, 100],
  [80, 180],
  [60, 260],
  [100, 350],
  [700, 90],
  [740, 160],
  [720, 250],
  [680, 340],
];

/** The circuit-board loader with "KANE CLI" on the chip. Decorative: give it a text label nearby. */
export function KaneCircuit({ label = "KANE CLI", className = "" }: { label?: string; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const chip = `kc-chip-${uid}`;
  const text = `kc-text-${uid}`;
  const pin = `kc-pin-${uid}`;
  return (
    <div className={`kc-main ${className}`}>
      <div className="kc-loader">
        <svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id={chip} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2d2d2d" />
              <stop offset="100%" stopColor="#0f0f0f" />
            </linearGradient>
            <linearGradient id={text} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#eeeeee" />
              <stop offset="100%" stopColor="#888888" />
            </linearGradient>
            <linearGradient id={pin} x1="1" y1="0" x2="0" y2="0">
              <stop offset="0%" stopColor="#bbbbbb" />
              <stop offset="50%" stopColor="#888888" />
              <stop offset="100%" stopColor="#555555" />
            </linearGradient>
          </defs>

          <g>
            {TRACES.map(([d, colour], i) => (
              <g key={i}>
                <path d={d} className="kc-trace-bg" />
                <path d={d} className={`kc-trace-flow kc-${colour}`} />
              </g>
            ))}
          </g>

          <rect x="330" y="190" width="140" height="100" rx="20" ry="20" fill={`url(#${chip})`} stroke="#222" strokeWidth="3" filter="drop-shadow(0 0 6px rgba(0,0,0,0.8))" />

          <g>
            {PINS_Y.map((y) => (
              <rect key={`l${y}`} x="322" y={y} width="8" height="10" fill={`url(#${pin})`} rx="2" />
            ))}
          </g>
          <g>
            {PINS_Y.map((y) => (
              <rect key={`r${y}`} x="470" y={y} width="8" height="10" fill={`url(#${pin})`} rx="2" />
            ))}
          </g>

          <text x="400" y="240" className="kc-chip-text" fontSize="22" fill={`url(#${text})`} textAnchor="middle" alignmentBaseline="middle" dominantBaseline="middle">
            {label}
          </text>

          {ENDS.map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5" fill="black" />
          ))}
        </svg>
      </div>
    </div>
  );
}
