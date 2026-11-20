const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

export const formatDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const formatShortDate = (iso: string | number) => shortDate.format(new Date(iso));
export const formatTime = (iso: string | number | null | undefined) => (iso == null ? "—" : timeFmt.format(new Date(iso)));
export const formatDateTime = (iso: string | null | undefined) => (iso ? `${formatDate(iso)}, ${formatTime(iso)}` : "—");

export function formatDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 48) return rest ? `${h} h ${rest} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const d = now - new Date(iso).getTime();
  if (d < 0) return "just now";
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return `${Math.round(d / 86_400_000)} days ago`;
}

/** First 8 and last 4 characters of a hash, as people compare them by eye. */
export const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : "—");

export const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export const credits = (n: number | null | undefined) => (n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

export function initials(s: string): string {
  const words = s.replace(/[^A-Za-z0-9 ._-]/g, "").split(/[ ._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const letters = (words[0] ?? s).replace(/[^A-Za-z]/g, "");
  return (letters.slice(0, 2) || s.slice(0, 2)).toUpperCase();
}

export function claimStatusLabel(s: string | null | undefined): string {
  if (s === "passed") return "Passed";
  if (s === "failed") return "Failed";
  if (s === "couldnt_verify") return "Couldn’t verify";
  return "Not run";
}

/** Tick marks for a time axis: about `target` evenly spaced, on round clock values. */
export function timeTicks(start: number, end: number, target = 6): { at: number; label: string }[] {
  const steps = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080].map((m) => m * 60_000);
  const span = Math.max(end - start, 60_000);
  const step = steps.find((s) => span / s <= target) ?? steps[steps.length - 1]!;
  const offset = new Date(start).getTimezoneOffset() * 60_000;
  const first = Math.ceil((start - offset) / step) * step + offset;
  const out: { at: number; label: string }[] = [];
  for (let t = first; t <= end; t += step) out.push({ at: t, label: step >= 86_400_000 ? formatShortDate(t) : formatTime(t) });
  return out;
}
