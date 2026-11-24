import { useId, useMemo } from "react";

// Sky pieces for the landing page, drawn with inline SVG (the CSP allows no images from other
// hosts and no data: URIs). Clouds are white blobs pushed around by fractal noise and lightly
// blurred, with a cool shadow underneath, so they read as soft cumulus rather than icons.

type Puff = { cx: number; cy: number; rx: number; ry: number };

function CloudShape({ puffs, w, h, seed, scale = 55, blur = 1.6 }: { puffs: Puff[]; w: number; h: number; seed: number; scale?: number; blur?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <filter id={`f${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="4" seed={seed} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={scale} xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation={blur} />
        </filter>
        <radialGradient id={`g${id}`} cx="50%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="62%" stopColor="#f4f8fd" />
          <stop offset="100%" stopColor="#c9d9ee" />
        </radialGradient>
      </defs>
      <g filter={`url(#f${id})`}>
        {puffs.map((p, i) => (
          <ellipse key={`s${i}`} cx={p.cx + 6} cy={p.cy + p.ry * 0.35} rx={p.rx} ry={p.ry * 0.9} fill="#b7cbe6" opacity="0.55" />
        ))}
        {puffs.map((p, i) => (
          <ellipse key={i} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill={`url(#g${id})`} />
        ))}
      </g>
    </svg>
  );
}

/** One floating cumulus cloud. */
export function Cloud({ className, seed = 3 }: { className?: string; seed?: number }) {
  const puffs = useMemo<Puff[]>(
    () => [
      { cx: 120, cy: 120, rx: 70, ry: 42 },
      { cx: 190, cy: 92, rx: 78, ry: 58 },
      { cx: 265, cy: 112, rx: 66, ry: 44 },
      { cx: 160, cy: 134, rx: 92, ry: 30 },
      { cx: 236, cy: 136, rx: 96, ry: 28 },
    ],
    [],
  );
  return (
    <div className={`cloud ${className ?? ""}`}>
      <CloudShape puffs={puffs} w={400} h={190} seed={seed} />
    </div>
  );
}

/** A wide bank of clouds, for the bottom of a section. */
export function CloudBank({ className, seed = 7 }: { className?: string; seed?: number }) {
  const puffs = useMemo<Puff[]>(() => {
    const out: Puff[] = [];
    let s = seed * 97;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let x = -60; x < 1660; x += 70 + rnd() * 50) {
      out.push({ cx: x, cy: 250 + rnd() * 70, rx: 110 + rnd() * 90, ry: 80 + rnd() * 70 });
    }
    for (let x = -40; x < 1660; x += 120) out.push({ cx: x, cy: 420, rx: 160, ry: 120 });
    return out;
  }, [seed]);
  return (
    <div className={`cloud-bank ${className ?? ""}`} aria-hidden="true">
      <CloudShape puffs={puffs} w={1600} h={460} seed={seed} scale={90} blur={3} />
    </div>
  );
}

/** A field of small stars for the night section. */
export function Stars({ count = 90 }: { count?: number }) {
  const stars = useMemo(() => {
    let s = 41;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    return Array.from({ length: count }, () => ({ x: rnd() * 100, y: rnd() * 70, r: rnd() < 0.15 ? 1.4 : 0.8, o: 0.3 + rnd() * 0.6, d: rnd() * 4 }));
  }, [count]);
  return (
    <svg className="stars" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {stars.map((st, i) => (
        <circle key={i} cx={st.x} cy={st.y} r={st.r / 10} fill="#fff" opacity={st.o} style={{ animationDelay: `${st.d}s` }} />
      ))}
    </svg>
  );
}

/** The landing's day sky behind every signed-in page: one single drifting cloud on the blue. */
export function SkyBackdrop() {
  return (
    <div className="sky-backdrop" aria-hidden="true">
      <div className="sb-cloud sb-1">
        <Cloud seed={4} />
      </div>
    </div>
  );
}
