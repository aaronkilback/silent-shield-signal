// _shared/safe-fetch.ts — SSRF guard (WO-SSRF-SHARED-GUARD-01).
//
// NOT applied at any call site yet. Build + negative-test first, then adopt per call site.
//
// assertPublicUrl(url): scheme allowlist + literal-IP block + DNS-resolve-and-check every
// resolved address (defeats hostname->private, e.g. 10.0.0.1.nip.io). Fails CLOSED on
// unresolvable / unparseable.
// safeFetch(url, opts): re-validates EVERY hop with redirect:'manual' so an allowed public
// host cannot 3xx-redirect to a private/metadata target.

export class SsrfBlockedError extends Error {
  constructor(public reason: string, public detail: string) {
    super(`SSRF blocked: ${reason} (${detail})`);
    this.name = "SsrfBlockedError";
  }
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1, 5).map(Number);
  if (o.some((n) => n > 255)) return null;
  return (((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0;
}

// [network, prefix-length] — private, loopback, link-local (incl. 169.254.169.254 metadata),
// CGNAT, benchmarking, reserved, multicast, broadcast.
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4], ["255.255.255.255", 32],
];

function isBlockedV4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return true; // unparseable → block (fail closed)
  for (const [net, len] of BLOCKED_V4) {
    const netInt = ipv4ToInt(net)!;
    const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
    if ((ipInt & mask) === (netInt & mask)) return true;
  }
  return false;
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;                 // loopback / unspecified
  if (/^(fe80|fc|fd)/.test(lower)) return true;                        // link-local / ULA
  const mapped = lower.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); // ::ffff:a.b.c.d
  if (mapped) return isBlockedV4(mapped[1]);
  return false;
}

function isIPv4(h: string): boolean { return /^\d{1,3}(\.\d{1,3}){3}$/.test(h); }
function isIPv6(h: string): boolean { return h.includes(":"); }

/** Validate a URL is safe to fetch server-side. Throws SsrfBlockedError otherwise. Returns the parsed URL. */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new SsrfBlockedError("malformed_url", String(rawUrl)); }
  if (!ALLOWED_SCHEMES.has(u.protocol)) throw new SsrfBlockedError("scheme", u.protocol);

  let host = u.hostname;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1); // ipv6 literal
  host = host.toLowerCase();

  if (isIPv4(host)) { if (isBlockedV4(host)) throw new SsrfBlockedError("private_ip", host); return u; }
  if (isIPv6(host)) { if (isBlockedV6(host)) throw new SsrfBlockedError("private_ip", host); return u; }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new SsrfBlockedError("private_host", host);
  }

  // hostname → resolve and check EVERY resolved address (defeats hostname->private rebind)
  let addrs: string[] = [];
  try {
    const [a, aaaa] = await Promise.all([
      Deno.resolveDns(host, "A").catch(() => [] as string[]),
      Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
    ]);
    addrs = [...a, ...aaaa];
  } catch (e) {
    // resolveDns unavailable in this runtime → fail closed (cannot prove the target is public)
    throw new SsrfBlockedError("dns_unavailable", `${host}: ${(e as Error)?.message ?? e}`);
  }
  if (addrs.length === 0) throw new SsrfBlockedError("unresolvable", host);
  for (const ip of addrs) {
    const blocked = isIPv4(ip) ? isBlockedV4(ip) : isBlockedV6(ip);
    if (blocked) throw new SsrfBlockedError("resolves_to_private", `${host} -> ${ip}`);
  }
  return u;
}

/** SSRF-safe fetch: validates every hop (redirect:'manual') so a public host cannot redirect to a private one. */
export async function safeFetch(rawUrl: string, opts: RequestInit = {}, maxRedirects = 4): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await assertPublicUrl(current);
    const resp = await fetch(u.toString(), { ...opts, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const loc = resp.headers.get("location");
      if (!loc) return resp;
      current = new URL(loc, u).toString(); // re-validated at the top of the next iteration
      continue;
    }
    return resp;
  }
  throw new SsrfBlockedError("too_many_redirects", rawUrl);
}
