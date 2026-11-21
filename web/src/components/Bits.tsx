import { useState, type ReactNode } from "react";
import type { Form } from "../state";
import * as I from "./Icons";

export function Pill({ form = "solid", icon, title, sub, href }: { form?: Form; icon: ReactNode; title: ReactNode; sub?: ReactNode; href?: string }) {
  const body = (
    <>
      <span className={`pill-icon ${form === "solid" ? "" : form}`} aria-hidden="true">
        {icon}
      </span>
      <span className="pill-text">
        <b>{title}</b>
        {sub ? (
          <>
            <br />
            <span>{sub}</span>
          </>
        ) : null}
      </span>
    </>
  );
  return href ? (
    <a className="pill" href={href}>
      {body}
    </a>
  ) : (
    <div className="pill">{body}</div>
  );
}

export function Tag({ form = "outline", children }: { form?: Form; children: ReactNode }) {
  return <span className={`tag ${form === "outline" ? "" : form}`}>{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="notice" role="alert">
      <I.CircleAlert size={20} aria-hidden="true" />
      <p>
        <b>Couldn’t load this page.</b> {error.message}
      </p>
      {onRetry ? (
        <button type="button" className="btn sm" onClick={onRetry}>
          <I.RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ height, flex = "1 1 300px" }: { height: number; flex?: string }) {
  return <div className="skeleton" style={{ height, flex }} aria-hidden="true" />;
}

export function LoadingRows() {
  return (
    <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <span className="sr-only">Loading</span>
      <div className="row">
        <Skeleton height={300} flex="2 1 520px" />
        <Skeleton height={300} flex="1 1 250px" />
        <Skeleton height={300} flex="1 1 250px" />
      </div>
      <div className="row">
        <Skeleton height={260} flex="1 1 300px" />
        <Skeleton height={260} flex="999 1 560px" />
      </div>
    </div>
  );
}

export function Notice({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="notice" role="status">
      {icon ?? <I.CircleAlert size={18} aria-hidden="true" />}
      <p>{children}</p>
      {action}
    </div>
  );
}

export function FormError({ error }: { error: { message: string; problems?: string[] } | null }) {
  if (!error) return null;
  return (
    <div className="notice" role="alert">
      <I.CircleAlert size={18} aria-hidden="true" />
      <p>
        {error.message}
        {error.problems?.length ? (
          <>
            <br />
            {error.problems.join(" ")}
          </>
        ) : null}
      </p>
    </div>
  );
}

/** Copy text to the clipboard, with a visible confirmation. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        });
      }}
    >
      {done ? <I.Check size={14} aria-hidden="true" /> : <I.Copy size={14} aria-hidden="true" />}
      {done ? "Copied" : label}
    </button>
  );
}

export function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div className="code-head">
        <span>{title}</span>
        <CopyButton text={code} />
      </div>
      <pre className="code">{code}</pre>
    </div>
  );
}

/** Pass / fail / unknown as form, not colour. */
export function ResultMark({ status }: { status: string | null | undefined }) {
  const kind = status === "passed" || status === "found" ? "pass" : status === "failed" || status === "app_failure" || status === "missing" ? "fail" : "unknown";
  return (
    <span className={`result-mark ${kind}`} aria-hidden="true">
      {kind === "pass" ? <I.Check size={12} strokeWidth={2.6} /> : kind === "fail" ? <I.X size={12} strokeWidth={2.6} /> : null}
    </span>
  );
}

export function DemoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="demo-banner" role="note">
      <span className="guest-badge">DEMO</span>
      <span>{children}</span>
    </div>
  );
}
