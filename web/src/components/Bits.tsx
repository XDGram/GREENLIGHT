import type { ReactNode } from "react";
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
