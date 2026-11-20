import { createContext, useCallback, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

// A small History-API router for the handful of /app pages (no dependency needed).

export type Route =
  | { name: "home" }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "approvals" }
  | { name: "records" }
  | { name: "not_found" };

export function parse(pathname: string): Route {
  const p = pathname.replace(/\/+$/, "");
  if (p === "/app" || p === "") return { name: "home" };
  if (p === "/app/projects") return { name: "projects" };
  const m = /^\/app\/projects\/(prj_[0-9a-f]{32})$/.exec(p);
  if (m) return { name: "project", id: m[1] };
  if (p === "/app/approvals") return { name: "approvals" };
  if (p === "/app/records") return { name: "records" };
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
