import { Link } from "../router";

const STEPS = [
  { key: "project", label: "Project" },
  { key: "tests", label: "Claims and tests" },
  { key: "approve", label: "Approve" },
  { key: "verify", label: "Verify" },
] as const;
export type FlowStep = (typeof STEPS)[number]["key"];

/** Where a project is in the add → tests → approve → verify flow. */
export function Stepper({ current, projectId, done = [] }: { current: FlowStep; projectId?: string; done?: FlowStep[] }) {
  const href = (k: FlowStep) => (!projectId ? null : k === "project" ? `/app/projects/${projectId}` : k === "tests" ? `/app/projects/${projectId}/tests` : k === "verify" ? `/app/projects/${projectId}/verify` : null);
  return (
    <ol className="stepper" aria-label="Progress">
      {STEPS.map((s, i) => {
        const to = href(s.key);
        const body = (
          <>
            <span className="step-n" aria-hidden="true">
              {i + 1}
            </span>
            {s.label}
          </>
        );
        return (
          <li key={s.key} aria-current={s.key === current ? "step" : undefined} className={done.includes(s.key) ? "done" : undefined}>
            {to && s.key !== current ? (
              <Link href={to} style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit" }}>
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}
