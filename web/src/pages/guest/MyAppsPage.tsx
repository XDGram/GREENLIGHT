import { guestApi } from "../../api";
import { Empty, ErrorNotice, LoadingRows, Pill, Tag } from "../../components/Bits";
import * as I from "../../components/Icons";
import { TopBar } from "../../components/Shell";
import { credits, formatDate, host } from "../../format";
import { Link } from "../../router";
import type { GuestLimits } from "../../types";
import { useData } from "../../useData";

export function MyAppsPage({ limits }: { limits: GuestLimits | null }) {
  const { value, reload } = useData(() => guestApi.projects(), []);
  const list = value.state === "ready" ? value.data : [];
  return (
    <>
      <TopBar title="My apps" eyebrow="Guest workspace · remembered on this browser">
        <Pill form="outline" icon={<I.Play size={14} />} title={`${limits?.runsLeft ?? 0} demo checks left`} sub="Free · no credits are spent" />
        <Link href="/app/try/new" className="btn">
          Add an app
        </Link>
      </TopBar>
      {value.state === "loading" ? <LoadingRows /> : null}
      {value.state === "error" ? <ErrorNotice error={value.error} onRetry={reload} /> : null}
      {value.state === "ready" && list.length === 0 ? (
        <section className="card">
          <Empty title="No apps yet">
            <span>Add your app’s public address and describe what it does. Greenlight writes the tests, you approve them, and a free demo check reads your live site.</span>
            <Link href="/app/try/new" className="btn" style={{ marginTop: 8 }}>
              Add an app
            </Link>
          </Empty>
        </section>
      ) : null}
      <div className="grid-cards">
        {list.map((p) => (
          <Link key={p.id} href={`/app/try/${p.id}`} className="project-card">
            <div className="card-head">
              <span className="mono small">{host(p.url)}</span>
              <span className={`pill-icon ${p.approvedAt ? "" : "outline"}`} style={{ width: 30, height: 30 }} aria-hidden="true">
                {p.approvedAt ? <I.Check size={13} strokeWidth={2.4} /> : <I.Clock size={13} />}
              </span>
            </div>
            <h3>{p.name}</h3>
            <dl className="kv">
              <div>
                <dt>Claims</dt>
                <dd className="num">{p.claims.length}</dd>
              </div>
              <div>
                <dt>Tests</dt>
                <dd className="num">{p.tests.length}</dd>
              </div>
              <div>
                <dt>Credits</dt>
                <dd className="num">{credits(p.estimate?.credits)}</dd>
              </div>
            </dl>
            <div className="tags">
              <Tag form={p.approvedAt ? "solid" : "outline"}>{p.approvedAt ? "Approved" : "Needs approval"}</Tag>
              <Tag>{p.source === "ai" ? "Written by AI" : "Written by hand"}</Tag>
              <Tag form="dashed">Added {formatDate(p.createdAt)}</Tag>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
