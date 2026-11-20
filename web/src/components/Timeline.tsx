import { useMemo, useState, type CSSProperties } from "react";
import { formatDuration, formatShortDate, formatTime, timeTicks } from "../format";
import type { PathStep } from "../state";
import { Avatar } from "./Chrome";
import * as I from "./Icons";

type Range = "fit" | "day" | "week";
const RANGES: { key: Range; label: string }[] = [
  { key: "fit", label: "All" },
  { key: "day", label: "24 h" },
  { key: "week", label: "7 days" },
];

/** The verification path drawn on a time axis: one row per step, real timestamps only. */
export function Timeline({ steps, approver }: { steps: PathStep[]; approver: string | null }) {
  const [range, setRange] = useState<Range>("fit");
  const now = Date.now();
  const hasOpen = steps.some((s) => s.start != null && s.end == null);

  const [d0, d1] = useMemo(() => {
    const times = steps.flatMap((s) => [s.start, s.end]).filter((x): x is number => x != null);
    let lo = Math.min(...times);
    let hi = Math.max(...times, hasOpen ? now : -Infinity);
    if (range === "day") [lo, hi] = [now - 86_400_000, now];
    if (range === "week") [lo, hi] = [now - 7 * 86_400_000, now];
    const span = Math.max(hi - lo, 90 * 60_000);
    // Leave room on the right for steps that have not happened yet.
    return [lo - span * 0.06, lo + span * 1.9];
  }, [steps, range, hasOpen, now]);

  const pct = (x: number) => Math.min(100, Math.max(0, ((x - d0) / (d1 - d0)) * 100));
  const lastKnown = Math.max(...steps.flatMap((s) => [s.end ?? s.start ?? -Infinity]), hasOpen ? now : -Infinity);
  const anchor = pct(Number.isFinite(lastKnown) ? lastKnown : d0);
  const ticks = timeTicks(d0, d1, 7).filter((tk) => pct(tk.at) > 3 && pct(tk.at) < 88);
  const sameDay = new Date(d0).toDateString() === new Date(d1).toDateString();

  const place = (left: number, right?: number): CSSProperties =>
    left > 45 ? { right: `${100 - (right ?? left)}%` } : right != null ? { left: `${left}%`, width: `${Math.max(right - left, 0)}%`, minWidth: "max-content" } : { left: `${left}%` };

  const bar = (s: PathStep) => {
    if (s.key === "submitted" && s.start != null) {
      return (
        <div className="tl-bar solid" style={place(pct(s.start))}>
          {formatTime(s.start)} · {s.note}
        </div>
      );
    }
    if (s.state === "done" && s.start != null) {
      const end = s.end ?? s.start;
      const label = s.key === "approved" ? `Approved ${formatTime(end)} · ${formatDuration(end - s.start)}` : s.key === "certified" ? `${s.note} · ${formatTime(end)}` : `${s.note}`;
      return (
        <div className={`tl-bar solid ${s.key === "approved" && approver ? "has-avatar" : ""}`} style={place(pct(s.start), pct(end))}>
          {label}
          {s.key === "approved" && approver ? <Avatar name={approver} small /> : null}
        </div>
      );
    }
    if (s.state === "current" && s.start != null) {
      return (
        <div className="tl-bar outline" style={place(pct(s.start), pct(now))}>
          <I.Clock size={13} aria-hidden="true" /> {s.note} · {formatDuration(now - s.start)}
        </div>
      );
    }
    if (s.state === "blocked") {
      return (
        <div className="tl-bar outline" style={place(s.start != null ? pct(s.start) : anchor)}>
          <I.CircleAlert size={13} aria-hidden="true" /> {s.note}
        </div>
      );
    }
    return (
      <div className={`tl-bar ${s.state === "current" ? "outline" : "dashed"}`} style={place(anchor)}>
        {s.note}
      </div>
    );
  };

  return (
    <section className="card" aria-labelledby="tl-h" style={{ flex: "2 1 540px" }}>
      <div className="card-head">
        <h2 id="tl-h" className="label">
          <I.CalendarDays size={16} aria-hidden="true" />
          {sameDay ? formatShortDate(d0) : `${formatShortDate(d0)} – ${formatShortDate(d1)}`} · Verification path
        </h2>
        <div className="seg" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="timeline-scroll">
        <div className="timeline">
          {steps.map((s) => (
            <div key={s.key} style={{ display: "contents" }}>
              <span className="tl-label">{s.label}</span>
              <div className="tl-track">
                <div className="tl-grid" aria-hidden="true">
                  {ticks.map((tk) => (
                    <span key={tk.at} style={{ left: `${pct(tk.at)}%` }} />
                  ))}
                </div>
                {bar(s)}
              </div>
            </div>
          ))}
          <span />
          <div className="tl-axis" aria-hidden="true">
            {ticks.map((tk) => (
              <span key={tk.at} style={{ left: `${pct(tk.at)}%` }}>
                {tk.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
