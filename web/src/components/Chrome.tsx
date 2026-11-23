import { useId } from "react";
import { initials } from "../format";

export function Logo({ size = 22 }: { size?: number }) {
  // A traffic light on green: red and amber dark, the bottom lamp lit.
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="5" y="0" width="12" height="22" rx="6" fill="var(--ink)" />
      <circle cx="11" cy="5.2" r="2.5" fill="#4a4a45" />
      <circle cx="11" cy="11" r="2.5" fill="#4a4a45" />
      <circle cx="11" cy="16.8" r="2.7" fill="var(--go)" />
    </svg>
  );
}

/** A traffic light with one lamp lit: green for passed, red for failed, amber for could not verify. */
export function TrafficLight({ lit, label }: { lit: "green" | "amber" | "red" | null; label?: string }) {
  return (
    <span className="tlight" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"}>
      <span className={`lamp red ${lit === "red" ? "on" : ""}`} />
      <span className={`lamp amber ${lit === "amber" ? "on" : ""}`} />
      <span className={`lamp green ${lit === "green" ? "on" : ""}`} />
    </span>
  );
}

export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={small ? "avatar sm" : "avatar"} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/**
 * A liquid-chrome sphere drawn in SVG: a lit sphere, a soft reflection and two warped rings.
 * Decorative only; the slow ring rotation stops when the viewer prefers reduced motion.
 */
export function ChromeOrb({ intensity = 1 }: { intensity?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className="orb" aria-hidden="true">
      <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id={`${id}-sphere`} cx="44%" cy="36%" r="62%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="16%" stopColor="#e9e9e9" />
            <stop offset="38%" stopColor="#8d8d8d" />
            <stop offset="64%" stopColor="#2c2c2c" />
            <stop offset="100%" stopColor="#060606" />
          </radialGradient>
          <radialGradient id={`${id}-rim`} cx="50%" cy="50%" r="50%">
            <stop offset="70%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="92%" stopColor="#ffffff" stopOpacity={0.55 * intensity} />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="45%" stopColor="#6a6a6a" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.75" />
          </linearGradient>
          <filter id={`${id}-liquid`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="0.6" />
          </filter>
          <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="18" />
          </filter>
        </defs>
        <ellipse cx="200" cy="230" rx="150" ry="22" fill="#000" opacity="0.55" filter={`url(#${id}-glow)`} />
        <g className="spin">
          <g filter={`url(#${id}-liquid)`}>
            <ellipse cx="200" cy="132" rx="138" ry="78" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="9" opacity="0.55" />
            <ellipse cx="200" cy="132" rx="108" ry="104" fill="none" stroke={`url(#${id}-ring)`} strokeWidth="5" opacity="0.4" transform="rotate(28 200 132)" />
          </g>
        </g>
        <circle cx="200" cy="132" r="62" fill={`url(#${id}-sphere)`} />
        <circle cx="200" cy="132" r="64" fill={`url(#${id}-rim)`} />
        <ellipse cx="180" cy="104" rx="22" ry="12" fill="#ffffff" opacity="0.85" transform="rotate(-24 180 104)" filter={`url(#${id}-liquid)`} />
      </svg>
    </div>
  );
}
