import { useCallback, useEffect, useRef, useState } from "react";
import { SignInRequired } from "./api";

export type Loadable<T> =
  | { state: "loading" }
  | { state: "ready"; data: T; refreshing: boolean }
  | { state: "error"; error: Error };

/**
 * Load data once and refresh it every `refreshMs` while the page is visible. A sign-in error is
 * passed to `onSignIn` (the app shows its sign-in screen) instead of being shown in place.
 */
export function useData<T>(load: () => Promise<T>, deps: unknown[], { refreshMs = 30_000, onSignIn }: { refreshMs?: number; onSignIn?: (e: SignInRequired) => void } = {}) {
  const [value, setValue] = useState<Loadable<T>>({ state: "loading" });
  const loadRef = useRef(load);
  loadRef.current = load;
  const signInRef = useRef(onSignIn);
  signInRef.current = onSignIn;

  const run = useCallback(async (quiet: boolean) => {
    if (quiet) setValue((v) => (v.state === "ready" ? { ...v, refreshing: true } : v));
    try {
      const data = await loadRef.current();
      setValue({ state: "ready", data, refreshing: false });
    } catch (err) {
      if (err instanceof SignInRequired) {
        signInRef.current?.(err);
        return;
      }
      setValue((v) => (quiet && v.state === "ready" ? { ...v, refreshing: false } : { state: "error", error: err as Error }));
    }
  }, []);

  useEffect(() => {
    setValue({ state: "loading" });
    void run(false);
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void run(true);
    }, refreshMs);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { value, reload: () => run(true) };
}
