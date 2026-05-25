import { isIP } from "node:net";

/**
 * SSRF egress guard for the governed action proxy.
 *
 * The proxy forwards to the gate-authorized `action.target`. Even so, a Ward whose
 * envelope permits an http.* action without a tight target allowlist could be steered
 * at internal infrastructure or the cloud metadata endpoint. This classifier refuses
 * dangerous destinations:
 *
 *   - always: non-http(s) schemes, the unspecified address, and the link-local range
 *     169.254.0.0/16 / fe80::/10 (this covers 169.254.169.254 cloud-metadata) plus
 *     known metadata hostnames. These are never legitimate proxy targets.
 *   - opt-in (blockPrivateNetworks): also loopback (127.0.0.0/8, ::1), private RFC1918
 *     ranges, unique-local fc00::/7, and localhost/.local/.internal names.
 *
 * Literal-IP targets are classified directly (no DNS). For hostname targets, callers
 * that need rebinding-safe enforcement should resolve and re-check the connected IP;
 * that is left to the deployment and noted as the next hardening step.
 */

export interface EgressPolicy {
  /** Also block loopback / RFC1918 / unique-local / localhost-style hosts. */
  blockPrivateNetworks?: boolean;
}

export type EgressVerdict = { ok: true; url: URL } | { ok: false; reason: string };

const METADATA_HOSTNAMES = new Set(["metadata.google.internal", "metadata", "instance-data"]);

function ipv4Octets(host: string): number[] | null {
  if (isIP(host) !== 4) return null;
  return host.split(".").map((part) => Number(part));
}

/** Classify an address/host literal. Returns the blocked category, or null if it is a public/unknown host. */
export function blockedCategory(host: string, blockPrivate: boolean): string | null {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, "");

  // Hostname (non-IP) checks.
  if (isIP(lower) === 0) {
    if (METADATA_HOSTNAMES.has(lower)) return "metadata-hostname";
    if (blockPrivate && (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local") || lower.endsWith(".internal"))) {
      return "private-hostname";
    }
    return null; // resolvable hostname; DNS-time re-check is the deployment's responsibility
  }

  // IPv4
  const v4 = ipv4Octets(lower);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return "unspecified";
    if (a === 169 && b === 254) return "link-local"; // includes 169.254.169.254 metadata
    if (blockPrivate) {
      if (a === 127) return "loopback";
      if (a === 10) return "private";
      if (a === 172 && b >= 16 && b <= 31) return "private";
      if (a === 192 && b === 168) return "private";
      if (a === 100 && b >= 64 && b <= 127) return "carrier-grade-nat";
    }
    return null;
  }

  // IPv6
  if (isIP(lower) === 6) {
    if (lower === "::" ) return "unspecified";
    if (lower.startsWith("fe80")) return "link-local";
    if (lower === "::1" && blockPrivate) return "loopback";
    if (blockPrivate && (lower.startsWith("fc") || lower.startsWith("fd"))) return "unique-local"; // fc00::/7
    // IPv4-mapped (::ffff:a.b.c.d)
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blockedCategory(mapped[1], blockPrivate);
    return null;
  }

  return null;
}

export function classifyEgressUrl(raw: string, policy: EgressPolicy = {}): EgressVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `invalid URL: ${raw}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `scheme ${url.protocol} is not an allowed egress scheme` };
  }
  const category = blockedCategory(url.hostname, policy.blockPrivateNetworks === true);
  if (category) {
    return { ok: false, reason: `destination ${url.hostname} is in a blocked range (${category})` };
  }
  return { ok: true, url };
}
