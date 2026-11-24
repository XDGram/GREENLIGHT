import { createContext, useCallback, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

// A small History-API router for the handful of /app pages (no dependency needed).

export type Route =
  | { name: "home" }
  | { name: "new" }
  | { name: "projects" }
  | { name: "project_new" }
  | { name: "project"; id: string }
  | { name: "check"; id: string }
  | { name: "project_tests"; id: string }
  | { name: "project_verify"; id: string }
  | { name: "project_run"; id: string; recordId: string }
  | { name: "approvals" }
  | { name: "fixes" }
  | { name: "fix"; id: string }
  | { name: "sample" }
  | { name: "records" }
  | { name: "integrations" }
  | { name: "account" }
  | { name: "admin" }
  | { name: "admin_list"; kind: AdminKind }
  | { name: "demo" }
  | { name: "try" }
  | { name: "try_new" }
  | { name: "try_project"; id: string }
  | { name: "not_found" };

export const ADMIN_KINDS = ["users", "projects", "jobs", "records", "tokens", "events", "guests"] as const;
export type AdminKind = (typeof ADMIN_KINDS)[number];

export function parse(pathname: string): Route {
  const p = pathname.replace(/\/+$/, "");
  if (p === "/app" || p === "") return { name: "home" };
  if (p === "/app/new") return { name: "new" };
  if (p === "/app/projects") return { name: "projects" };
  if (p === "/app/projects/new") return { name: "project_new" };
  const m = /^\/app\/projects\/(prj_[0-9a-f]{32})(?:\/(tests|verify))?$/.exec(p);
  if (m) return m[2] === "tests" ? { name: "project_tests", id: m[1]! } : m[2] === "verify" ? { name: "project_verify", id: m[1]! } : { name: "project", id: m[1]! };
  const r = /^\/app\/projects\/(prj_[0-9a-f]{32})\/runs\/(vr_[0-9a-f]{32})$/.exec(p);
  if (r) return { name: "project_run", id: r[1]!, recordId: r[2]! };
  const ck = /^\/app\/check\/(prj_[0-9a-f]{32})$/.exec(p);
  if (ck) return { name: "check", id: ck[1]! };
  if (p === "/app/approvals") return { name: "approvals" };
  if (p === "/app/fixes") return { name: "fixes" };
  const fx = /^\/app\/fixes\/(fx_[0-9a-f]{32})$/.exec(p);
  if (fx) return { name: "fix", id: fx[1]! };
  if (p === "/app/sample") return { name: "sample" };
  if (p === "/app/records") return { name: "records" };
  if (p === "/app/integrations") return { name: "integrations" };
  if (p === "/app/account") return { name: "account" };
  if (p === "/app/admin") return { name: "admin" };
  const a = /^\/app\/admin\/([a-z]+)$/.exec(p);
  if (a && (ADMIN_KINDS as readonly string[]).includes(a[1]!)) return { name: "admin_list", kind: a[1] as AdminKind };
  if (p === "/app/demo") return { name: "demo" };
  if (p === "/app/try") return { name: "try" };
  if (p === "/app/try/new") return { name: "try_new" };
  const g = /^\/app\/try\/(gpj_[0-9a-f]{32})$/.exec(p);
  if (g) return { name: "try_project", id: g[1]! };
  return { name: "not_found" };
}

interface RouterValue {
  route: Route;
  search: URLSearchParams;
  navigate: (to: string) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const read = () => ({ route: parse(window.location.pathname), search: new URLSearchParams(window.location.search) });
  const [state, setState] = useState(read);
  useEffect(() => {
    const onPop = () => setState(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname + window.location.search) return;
    window.history.pushState(null, "", to);
    setState(read());
    window.scrollTo({ top: 0 });
  }, []);
  return <RouterContext.Provider value={{ ...state, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const v = useContext(RouterContext);
  if (!v) throw new Error("useRouter outside RouterProvider");
  return v;
}

/** An <a> that navigates inside the app without a page load (modifier clicks still open tabs). */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
