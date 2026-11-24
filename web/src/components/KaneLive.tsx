import { useEffect, useState } from "react";
import type { Job } from "../types";
import { KaneCircuit } from "./KaneCircuit";
import "../styles/kane-live.css";

// Only the states the server reports: queued, running, then the verdict replaces this view.
const STAGES = ["Queued", "Kane is running", "Verdict"];

function since(iso: string | null | undefined, now: number): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : 0;
}

function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Live view of a Kane run: the circuit loader with "KANE CLI" on the chip, the run's status as the
 * server reports it, a timer, and the claims the run covers. Kane does not report per-claim
 * progress mid-run, so nothing here claims to know which step it is on.
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
  const stage = running ? 1 : 0;
  const count = `${claims.length} ${claims.length === 1 ? "claim" : "claims"}`;

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
          <span key={stage} className="kl-line">
            {!running
              ? "kane-cli: waiting to start"
              : claims.length
                ? `kane-cli: running in a real browser, ${count} to check`
                : "kane-cli: running in a real browser"}
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
            {count} in this run
          </span>
          <ul>
            {claims.map((c) => (
              <li key={c.id}>
                <span className="kl-spin" aria-hidden="true" />
                <span className="kl-text">{c.text}</span>
                <span className="kl-wait">Result pending</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
