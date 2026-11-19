// Which hosts Greenlight may verify. Brief §5: every run targets a deployed URL,
// never localhost. A server-side certifier also must not be turned into a probe
// of its own network (SSRF), so loopback, private, link-local (cloud metadata),
// unspecified and other non-public addresses are refused, as are names that only
// resolve locally.
//
// isLocalOrPrivateHost() works on the URL's hostname alone (literal IPs and
// reserved names). assertPublicHost() additionally resolves DNS and checks every
// address, for code that will actually connect (the server).

import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

const LOCAL_NAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

function ipv4Private(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || // "this" network / unspecified
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0.0/24 IETF, 192.0.2.0/24 documentation
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

function ipv6Private(ip) {
  const x = ip.toLowerCase();
  if (x === "::" || x === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (mapped) return ipv4Private(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(x);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return ipv4Private(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return (
    /^f[cd]/.test(x) || // unique local fc00::/7
    /^fe[89ab]/.test(x) || // link-local fe80::/10
    /^ff/.test(x) || // multicast
    x.startsWith("64:ff9b:") || // NAT64 can reach IPv4 private space
    x.startsWith("2001:db8:") // documentation
  );
}

/** True when an IP literal is not a public unicast address. */
export function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) return ipv4Private(ip);
  if (family === 6) return ipv6Private(ip);
  return false;
}

/**
 * True when the hostname (as URL.hostname gives it) is local, private or reserved.
 * Literal IPs are checked by range; names by reserved suffix. Never throws.
 */
export function isLocalOrPrivateHost(hostname) {
  if (typeof hostname !== "string" || hostname === "") return true;
  let h = hostname.toLowerCase();
  // Let the WHATWG URL parser normalise exotic IPv4 forms ("0x7f.1", "2130706433").
  try {
    h = new URL(`http://${h.includes(":") && !h.startsWith("[") ? `[${h}]` : h}/`).hostname;
  } catch {
    return true; // not a valid host at all
  }
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (net.isIP(h)) return isPrivateIp(h);
  if (LOCAL_NAMES.has(h) || LOCAL_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (!h.includes(".")) return true; // single-label names only resolve on a local network
  // Any remaining all-numeric/hex dotted form is never a public host name.
  if (/^(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+))*$/i.test(h)) return true;
  return false;
}

/**
 * Resolve a public-looking host and refuse it if ANY address is private.
 * @param {string} hostname
 * @param {{lookup?: (host: string, opts: object) => Promise<{address: string}[]>}} [opts]
 * @returns {Promise<{ok: true, addresses: string[]} | {ok: false, reason: string}>}
 */
export async function assertPublicHost(hostname, { lookup = dnsLookup } = {}) {
  if (isLocalOrPrivateHost(hostname)) return { ok: false, reason: "host_not_public" };
  let h = hostname.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (net.isIP(h)) return { ok: true, addresses: [h] };
  let addrs;
  try {
    addrs = await lookup(h, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "host_unresolvable" };
  }
  const list = (Array.isArray(addrs) ? addrs : [addrs]).map((a) => a?.address).filter(Boolean);
  if (list.length === 0) return { ok: false, reason: "host_unresolvable" };
  if (list.some((a) => isPrivateIp(a))) return { ok: false, reason: "host_resolves_to_private_address" };
  return { ok: true, addresses: list };
}
