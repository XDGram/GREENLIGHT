import { Tag } from "../components/Bits";
import { Avatar } from "../components/Chrome";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { formatDateTime } from "../format";
import { Link } from "../router";
import type { Session } from "../types";

export function AccountPage({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const display = session.name ?? session.email ?? session.username ?? session.user;
  return (
    <>
      <TopBar title="Account" eyebrow={session.role === "admin" ? "Administrator" : "Your Greenlight account"} />
      <div className="row">
        <section className="card" aria-labelledby="who-h" style={{ flex: "2 1 460px" }}>
          <div className="card-head">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avatar name={display} />
              <h2 id="who-h" className="card-title lg">
                {display}
              </h2>
            </div>
            <Tag form="solid">{session.role === "admin" ? "Administrator" : "Member"}</Tag>
          </div>
          <dl className="kv-list">
            <dt>Signed in with</dt>
            <dd>{session.provider === "google" ? "Google" : "Vercel"}</dd>
            {session.email ? (
              <>
                <dt>Email</dt>
                <dd>{session.email}</dd>
              </>
            ) : null}
            <dt>Account</dt>
            <dd className="mono">{session.account}</dd>
            <dt>Approves as</dt>
            <dd>{session.user}</dd>
            <dt>Signed in</dt>
            <dd>{formatDateTime(session.authenticatedAt)}</dd>
            <dt>Session ends</dt>
            <dd>{formatDateTime(session.expiresAt)}</dd>
            <dt>Credit limit per run</dt>
            <dd>{session.maxCreditsPerRun ?? "—"}</dd>
          </dl>
          <div className="tags">
            <button type="button" className="btn ghost" onClick={onSignOut}>
              <I.LogOut size={15} aria-hidden="true" /> Sign out
            </button>
            <Link className="btn ghost" href="/app/integrations">
              <I.Plug size={15} aria-hidden="true" /> API tokens and integrations
            </Link>
          </div>
        </section>
        <section className="card-dark" aria-labelledby="sec-h" style={{ flex: "1 1 280px" }}>
          <h2 id="sec-h" className="card-title">
            How your account is protected
          </h2>
          <ul className="list" style={{ gap: 12, fontSize: 13 }}>
            {[
              "Only you can approve your tests, on a signed page that asks for both fingerprints.",
              "Every certification needs that signed approval, a fresh run on the deployed commit and your credit confirmation.",
              "Tokens are stored as hashes and can be revoked at any time.",
              "Your projects are invisible to other accounts.",
            ].map((t) => (
              <li key={t} style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr)", gap: 10, color: "var(--on-dark-muted)" }}>
                <I.Check size={15} style={{ marginTop: 2, color: "var(--on-dark)" }} aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
