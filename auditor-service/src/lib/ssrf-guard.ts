import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type SsrfRejectionCode =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "URL_CREDENTIALS"
  | "HOST_NOT_ALLOWED"
  | "HOST_BLOCKED"
  | "LOCALHOST_BLOCKED"
  | "METADATA_ENDPOINT_BLOCKED"
  | "DNS_RESOLUTION_FAILED"
  | "DNS_NO_ADDRESSES"
  | "NON_PUBLIC_ADDRESS"
  | "INVALID_REDIRECT";

export type IpAddressKind =
  | "PUBLIC"
  | "PRIVATE"
  | "LOOPBACK"
  | "LINK_LOCAL"
  | "CARRIER_GRADE_NAT"
  | "DOCUMENTATION"
  | "BENCHMARK"
  | "MULTICAST"
  | "RESERVED"
  | "UNSPECIFIED"
  | "METADATA"
  | "INVALID";

export interface DnsAddress {
  address: string;
  family: number;
}

export type DnsResolver = (hostname: string) => Promise<readonly DnsAddress[]>;

export interface SsrfGuardOptions {
  /** Exact hostnames or `*.example.com` rules. An empty list allows any public host. */
  allowedHosts?: readonly string[];
  /** Exact hostnames and their subdomains, or explicit `*.example.com` rules. */
  blockedHosts?: readonly string[];
  /** Unsafe by default. Intended only for an explicitly authorized test network. */
  allowPrivateAddresses?: boolean;
  /**
   * Exact DNS hostnames that may resolve to RFC1918/ULA addresses. This is
   * intended for isolated audit fixtures. Wildcards and IP literals are never
   * accepted, and localhost/metadata ranges remain blocked.
   */
  privateHostAllowlist?: readonly string[];
  /** Unsafe by default and ignored when `environment` is `production`. */
  allowLocalhost?: boolean;
  environment?: string;
  /** DNS is required by default so every returned address can be classified. */
  resolveDns?: boolean;
  resolver?: DnsResolver;
}

export interface SafeUrlResolution {
  url: URL;
  hostname: string;
  addresses: readonly DnsAddress[];
}

export type UrlValidationResult =
  | { safe: true; value: SafeUrlResolution }
  | { safe: false; error: SsrfValidationError };

export interface IpAddressClassification {
  address: string;
  version: 4 | 6 | 0;
  kind: IpAddressKind;
  public: boolean;
}

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata.azure.internal",
  "instance-data.ec2.internal"
]);

const METADATA_IPV4 = new Set([
  "169.254.169.254",
  "169.254.170.2",
  "168.63.129.16",
  "100.100.100.200",
  "192.0.0.192"
]);

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export class SsrfValidationError extends Error {
  readonly code: SsrfRejectionCode;
  readonly hostname?: string;

  constructor(code: SsrfRejectionCode, message: string, hostname?: string) {
    super(message);
    this.name = "SsrfValidationError";
    this.code = code;
    this.hostname = hostname;
  }
}

/**
 * Validates the initial target of an audit. The safe default is public HTTP(S)
 * only, with all DNS answers checked to prevent a mixed public/private answer
 * from bypassing the guard.
 */
export async function assertSafeAuditUrl(
  rawUrl: string | URL,
  options: SsrfGuardOptions = {}
): Promise<SafeUrlResolution> {
  const url = parseHttpUrl(rawUrl);
  const hostname = normalizeHostname(url.hostname);

  if (url.username || url.password) {
    throw new SsrfValidationError(
      "URL_CREDENTIALS",
      "URLs com credenciais embutidas não são permitidas.",
      hostname
    );
  }

  assertHostPolicy(hostname, options);

  const literalVersion = isIP(stripIpv6Brackets(hostname));
  const addresses: readonly DnsAddress[] = literalVersion
    ? [{ address: stripIpv6Brackets(hostname), family: literalVersion }]
    : await resolveAllAddresses(hostname, options);

  if (addresses.length === 0) {
    throw new SsrfValidationError(
      "DNS_NO_ADDRESSES",
      "O domínio não possui endereços DNS utilizáveis.",
      hostname
    );
  }

  for (const address of addresses) {
    assertAddressPolicy(address.address, options, hostname);
  }

  return { url, hostname, addresses: [...addresses] };
}

export async function validateAuditUrl(
  rawUrl: string | URL,
  options: SsrfGuardOptions = {}
): Promise<UrlValidationResult> {
  try {
    return { safe: true, value: await assertSafeAuditUrl(rawUrl, options) };
  } catch (error) {
    if (error instanceof SsrfValidationError) {
      return { safe: false, error };
    }
    throw error;
  }
}

/** Resolves a relative Location header and re-runs the complete SSRF policy. */
export async function assertSafeRedirectTarget(
  currentUrl: string | URL,
  location: string,
  options: SsrfGuardOptions = {}
): Promise<SafeUrlResolution> {
  let target: URL;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw new SsrfValidationError("INVALID_REDIRECT", "O redirecionamento contém uma URL inválida.");
  }
  return assertSafeAuditUrl(target, options);
}

/**
 * Fetches with redirects disabled at the transport layer and validates every
 * Location hop before following it. Callers should still apply timeouts and
 * response-size limits appropriate to their workload.
 */
export async function fetchWithSsrfGuard(
  rawUrl: string | URL,
  init: RequestInit = {},
  options: SsrfGuardOptions & { maxRedirects?: number; fetchImpl?: typeof fetch } = {}
): Promise<Response> {
  const maxRedirects = clampInteger(options.maxRedirects ?? 8, 0, 20);
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = await assertSafeAuditUrl(rawUrl, options);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(current.url, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return response;
    }

    if (redirectCount >= maxRedirects) {
      await response.body?.cancel().catch(() => undefined);
      throw new SsrfValidationError("INVALID_REDIRECT", "A URL excedeu o limite de redirecionamentos.");
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    await response.body?.cancel().catch(() => undefined);
    current = await assertSafeRedirectTarget(current.url, location, options);
  }
}

export function classifyIpAddress(rawAddress: string): IpAddressClassification {
  const address = stripIpv6Brackets(rawAddress.trim().toLowerCase());
  const version = isIP(address);
  if (version === 4) {
    const value = ipv4ToNumber(address);
    const kind = classifyIpv4(value, address);
    return { address, version: 4, kind, public: kind === "PUBLIC" };
  }

  if (version === 6) {
    const value = ipv6ToBigInt(address);
    if (value === null) {
      return { address, version: 0, kind: "INVALID", public: false };
    }

    const mappedIpv4 = getMappedIpv4(value);
    if (mappedIpv4 !== null) {
      const mappedAddress = numberToIpv4(mappedIpv4);
      const kind = classifyIpv4(mappedIpv4, mappedAddress);
      return { address, version: 6, kind, public: kind === "PUBLIC" };
    }

    const kind = classifyIpv6(value);
    return { address, version: 6, kind, public: kind === "PUBLIC" };
  }

  return { address, version: 0, kind: "INVALID", public: false };
}

function parseHttpUrl(rawUrl: string | URL): URL {
  let url: URL;
  try {
    const value = rawUrl instanceof URL ? rawUrl.toString() : rawUrl.trim();
    if (!value) {
      throw new Error("empty");
    }
    url = new URL(value);
  } catch {
    throw new SsrfValidationError("INVALID_URL", "A URL informada é inválida.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfValidationError(
      "UNSUPPORTED_PROTOCOL",
      "A auditoria aceita apenas URLs HTTP ou HTTPS."
    );
  }
  return url;
}

function assertHostPolicy(hostname: string, options: SsrfGuardOptions): void {
  if (METADATA_HOSTS.has(hostname)) {
    throw new SsrfValidationError(
      "METADATA_ENDPOINT_BLOCKED",
      "Endpoints de metadados de infraestrutura não podem ser auditados.",
      hostname
    );
  }

  if (isLocalHostname(hostname)) {
    const production = (options.environment ?? process.env.NODE_ENV ?? "development") === "production";
    if (!options.allowLocalhost || production) {
      throw new SsrfValidationError(
        "LOCALHOST_BLOCKED",
        "Endereços locais não podem ser auditados neste ambiente.",
        hostname
      );
    }
  }

  if (options.blockedHosts?.some((rule) => matchesBlockedHost(hostname, rule))) {
    throw new SsrfValidationError("HOST_BLOCKED", "O domínio está na lista de bloqueio.", hostname);
  }

  if (
    options.allowedHosts &&
    options.allowedHosts.length > 0 &&
    !options.allowedHosts.some((rule) => matchesAllowedHost(hostname, rule))
  ) {
    throw new SsrfValidationError("HOST_NOT_ALLOWED", "O domínio não está autorizado.", hostname);
  }
}

async function resolveAllAddresses(
  hostname: string,
  options: SsrfGuardOptions
): Promise<readonly DnsAddress[]> {
  if (options.resolveDns === false) {
    return [];
  }

  const resolver: DnsResolver =
    options.resolver ??
    (async (host) => dnsLookup(host, { all: true, verbatim: true }));

  try {
    const results = await resolver(hostname);
    return deduplicateAddresses(results).filter((item) => isIP(item.address) !== 0);
  } catch {
    throw new SsrfValidationError(
      "DNS_RESOLUTION_FAILED",
      "Não foi possível validar os endereços DNS do domínio.",
      hostname
    );
  }
}

function assertAddressPolicy(address: string, options: SsrfGuardOptions, hostname: string): void {
  const classification = classifyIpAddress(address);
  if (classification.kind === "METADATA") {
    throw new SsrfValidationError(
      "METADATA_ENDPOINT_BLOCKED",
      "Endpoints de metadados de infraestrutura não podem ser auditados.",
      hostname
    );
  }

  if (classification.kind === "LOOPBACK") {
    const production = (options.environment ?? process.env.NODE_ENV ?? "development") === "production";
    if (options.allowLocalhost && !production) {
      return;
    }
  } else if (
    classification.kind === "PRIVATE" &&
    (options.allowPrivateAddresses || isExactlyAllowedPrivateHost(hostname, options.privateHostAllowlist))
  ) {
    return;
  }

  if (!classification.public) {
    throw new SsrfValidationError(
      "NON_PUBLIC_ADDRESS",
      `O domínio resolve para um endereço de rede não público (${classification.kind}).`,
      hostname
    );
  }
}

function isExactlyAllowedPrivateHost(hostname: string, allowlist: readonly string[] | undefined): boolean {
  if (!allowlist || allowlist.length === 0 || isIP(stripIpv6Brackets(hostname)) !== 0) {
    return false;
  }
  const normalized = normalizeHostname(hostname);
  return allowlist.some((candidate) => {
    const raw = String(candidate ?? "").trim();
    if (!raw || raw.includes("*") || raw.includes("/") || raw.includes(":")) return false;
    const rule = normalizeHostname(raw);
    return Boolean(rule) && isIP(rule) === 0 && normalized === rule;
  });
}

function classifyIpv4(value: number, address: string): IpAddressKind {
  if (METADATA_IPV4.has(address)) return "METADATA";
  if (inIpv4Cidr(value, "0.0.0.0", 8)) return value === 0 ? "UNSPECIFIED" : "RESERVED";
  if (inIpv4Cidr(value, "10.0.0.0", 8)) return "PRIVATE";
  if (inIpv4Cidr(value, "100.64.0.0", 10)) return "CARRIER_GRADE_NAT";
  if (inIpv4Cidr(value, "127.0.0.0", 8)) return "LOOPBACK";
  if (inIpv4Cidr(value, "169.254.0.0", 16)) return "LINK_LOCAL";
  if (inIpv4Cidr(value, "172.16.0.0", 12)) return "PRIVATE";
  if (inIpv4Cidr(value, "192.0.0.0", 24)) return "RESERVED";
  if (inIpv4Cidr(value, "192.0.2.0", 24)) return "DOCUMENTATION";
  if (inIpv4Cidr(value, "192.168.0.0", 16)) return "PRIVATE";
  if (inIpv4Cidr(value, "198.18.0.0", 15)) return "BENCHMARK";
  if (inIpv4Cidr(value, "198.51.100.0", 24)) return "DOCUMENTATION";
  if (inIpv4Cidr(value, "203.0.113.0", 24)) return "DOCUMENTATION";
  if (inIpv4Cidr(value, "224.0.0.0", 4)) return "MULTICAST";
  if (inIpv4Cidr(value, "240.0.0.0", 4)) return "RESERVED";
  return "PUBLIC";
}

function classifyIpv6(value: bigint): IpAddressKind {
  if (value === 0n) return "UNSPECIFIED";
  if (value === 1n) return "LOOPBACK";
  if (value === ipv6ToBigInt("fd00:ec2::254")) return "METADATA";
  if (inIpv6Cidr(value, "fc00::", 7)) return "PRIVATE";
  if (inIpv6Cidr(value, "fe80::", 10)) return "LINK_LOCAL";
  if (inIpv6Cidr(value, "ff00::", 8)) return "MULTICAST";
  if (inIpv6Cidr(value, "2001:db8::", 32) || inIpv6Cidr(value, "3fff::", 20)) {
    return "DOCUMENTATION";
  }
  if (
    inIpv6Cidr(value, "2001::", 32) ||
    inIpv6Cidr(value, "2001:2::", 48) ||
    inIpv6Cidr(value, "2001:10::", 28) ||
    inIpv6Cidr(value, "2001:20::", 28) ||
    inIpv6Cidr(value, "2002::", 16)
  ) {
    return "RESERVED";
  }
  return inIpv6Cidr(value, "2000::", 3) ? "PUBLIC" : "RESERVED";
}

function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((value, octet) => (value * 256 + Number(octet)) >>> 0, 0);
}

function numberToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join(".");
}

function inIpv4Cidr(value: number, network: string, prefix: number): boolean {
  const networkValue = ipv4ToNumber(network);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0 === (networkValue & mask) >>> 0;
}

function ipv6ToBigInt(address: string): bigint | null {
  let normalized = address;
  const dottedMatch = normalized.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedMatch) {
    const ipv4 = ipv4ToNumber(dottedMatch[2]);
    normalized = `${dottedMatch[1]}${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || omitted < 0) return null;
  const words = [...left, ...Array.from({ length: omitted }, () => "0"), ...right];
  if (words.length !== 8 || words.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return null;
  return words.reduce((value, word) => (value << 16n) | BigInt(`0x${word}`), 0n);
}

function inIpv6Cidr(value: bigint, network: string, prefix: number): boolean {
  const networkValue = ipv6ToBigInt(network);
  if (networkValue === null) return false;
  const shift = BigInt(128 - prefix);
  return value >> shift === networkValue >> shift;
}

function getMappedIpv4(value: bigint): number | null {
  return value >> 32n === 0xffffn ? Number(value & 0xffffffffn) : null;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function normalizeHostname(hostname: string): string {
  return stripIpv6Brackets(hostname).toLowerCase().replace(/\.+$/, "");
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "home.arpa" ||
    hostname.endsWith(".home.arpa")
  );
}

function matchesAllowedHost(hostname: string, rawRule: string): boolean {
  const rule = normalizeHostname(rawRule.trim());
  if (!rule) return false;
  if (rule.startsWith("*.")) {
    const suffix = rule.slice(2);
    return hostname.endsWith(`.${suffix}`) && hostname !== suffix;
  }
  return hostname === rule;
}

function matchesBlockedHost(hostname: string, rawRule: string): boolean {
  const rule = normalizeHostname(rawRule.trim());
  if (!rule) return false;
  const suffix = rule.startsWith("*.") ? rule.slice(2) : rule;
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function deduplicateAddresses(addresses: readonly DnsAddress[]): DnsAddress[] {
  const seen = new Set<string>();
  return addresses.filter((item) => {
    const key = item.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
