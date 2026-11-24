import { useEffect, useState } from "react";
import type { Job } from "../types";
import { KaneCircuit } from "./KaneCircuit";
import "../styles/kane-live.css";

const STAGES = ["Queued", "Opening a browser", "Testing your claims", "Writing the verdict"];

function since(iso: string | null | undefined, now: number): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : 0;
}

function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Live view of a Kane run: the circuit loader with "KANE CLI" on the chip, the stage the run is
 * in, a timer, and the claims in this run with the one on screen cycling.
 */
export function KaneLive({ job, claims }: { job: Job; claims: { id: string; text: string }[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const running = job.status === "running";
  const ranFor = since(job.startedAt, now);
  const waited = since(job.createdAt, now);
  // Server status says queued or running; inside a run, the first seconds are the browser starting.
  const stage = !running ? 0 : ranFor < 25 ? 1 : 2;
  const focus = claims.length ? Math.floor(now / 4000) % claims.length : -1;

  return (
    <div className="kl" aria-live="polite">
      <div className="kl-board">
        <KaneCircuit />
        <div className="kl-hud">
          <span className="kl-live">
            <i aria-hidden="true" />
            {running ? "Live" : "Queued"}
          </span>
          <span className="kl-time">{clock(running ? ranFor : waited)}</span>
        </div>
        <div className="kl-ticker">
          <span className="kl-caret" aria-hidden="true">
            &gt;
          </span>
          <span key={`${stage}-${focus}`} className="kl-line">
            {!running
              ? "kane-cli: waiting for a free browser"
              : stage === 1
                ? "kane-cli: starting Chromium and opening your app"
                : focus >= 0
                  ? `kane-cli: checking "${claims[focus].text}"`
                  : "kane-cli: clicking through your app"}
          </span>
        </div>
        <div className="kl-bar" aria-hidden="true">
          <span />
        </div>
      </div>

      <ol className="kl-stages">
        {STAGES.map((s, i) => (
          <li key={s} className={i < stage ? "done" : i === stage ? "now" : ""}>
            <span className="kl-dot" aria-hidden="true" />
            {s}
          </li>
        ))}
      </ol>

      {claims.length ? (
        <div className="kl-claims">
          <span className="kl-claims-k">
            {claims.length} {claims.length === 1 ? "claim" : "claims"} in this run
          </span>
          <ul>
            {claims.map((c, i) => (
              <li key={c.id} className={running && stage === 2 && i === focus ? "on" : ""}>
                <span className="kl-spin" aria-hidden="true" />
                <span className="kl-text">{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
