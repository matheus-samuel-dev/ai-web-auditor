export interface RedactionOptions {
  replacement?: string;
  sensitiveKeys?: readonly string[];
  maxDepth?: number;
}

export interface SafeErrorDetails {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  cause?: unknown;
}

const DEFAULT_REPLACEMENT = "[REDACTED]";
const DEFAULT_SENSITIVE_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "pwd",
  "secret",
  "clientsecret",
  "apikey",
  "accesskey",
  "privatekey",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "session",
  "sessionid",
  "credential",
  "credentials"
]);

const SENSITIVE_KEY_IN_TEXT =
  "authorization|proxy[-_ ]?authorization|cookie|set[-_ ]?cookie|password|passwd|pwd|secret|client[-_ ]?secret|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|id[-_ ]?token|session(?:[-_ ]?id)?|credentials?";

const AUTH_HEADER_PATTERN = new RegExp(
  `\\b(authorization|proxy-authorization)\\s*[:=]\\s*(?:(bearer|basic)\\s+)?([^\\s,;]+)`,
  "gi"
);
const COOKIE_HEADER_PATTERN = /\b(cookie|set-cookie)\s*:\s*[^\r\n]*/gi;
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `((?:["']?(?:${SENSITIVE_KEY_IN_TEXT})["']?)\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&}]+)`,
  "gi"
);
const JWT_PATTERN = /\beyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\b/g;
const COMMON_API_KEY_PATTERN = /\b(?:sk-(?:proj-)?[a-zA-Z0-9_-]{12,}|AKIA[0-9A-Z]{16})\b/g;
const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/** Redacts credentials, auth headers, cookies, common tokens and URL secrets. */
export function redactText(text: string, options: RedactionOptions = {}): string {
  const replacement = options.replacement ?? DEFAULT_REPLACEMENT;
  let result = String(text);

  result = result.replace(URL_IN_TEXT_PATTERN, (candidate) => redactUrl(candidate, options));
  result = result.replace(AUTH_HEADER_PATTERN, (_match, header: string, scheme?: string) =>
    `${header}: ${scheme ? `${scheme} ` : ""}${replacement}`
  );
  result = result.replace(COOKIE_HEADER_PATTERN, (_match, header: string) => `${header}: ${replacement}`);
  result = result.replace(SECRET_ASSIGNMENT_PATTERN, (_match, prefix: string) => `${prefix}${replacement}`);
  result = result.replace(JWT_PATTERN, replacement);
  result = result.replace(COMMON_API_KEY_PATTERN, replacement);
  return result;
}

/** Removes URL userinfo and redacts sensitive query/fragment parameters. */
export function redactUrl(input: string | URL, options: RedactionOptions = {}): string {
  const replacement = options.replacement ?? DEFAULT_REPLACEMENT;
  let url: URL;
  try {
    url = new URL(input instanceof URL ? input.toString() : input);
  } catch {
    return String(input)
      .replace(AUTH_HEADER_PATTERN, (_match, header: string, scheme?: string) =>
        `${header}: ${scheme ? `${scheme} ` : ""}${replacement}`
      )
      .replace(SECRET_ASSIGNMENT_PATTERN, (_match, prefix: string) => `${prefix}${replacement}`)
      .replace(JWT_PATTERN, replacement)
      .replace(COMMON_API_KEY_PATTERN, replacement);
  }

  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (isSensitiveKey(key, options.sensitiveKeys)) {
      url.searchParams.set(key, replacement);
    }
  }

  if (url.hash.length > 1 && url.hash.includes("=")) {
    const fragmentParams = new URLSearchParams(url.hash.slice(1));
    let changed = false;
    for (const key of [...fragmentParams.keys()]) {
      if (isSensitiveKey(key, options.sensitiveKeys)) {
        fragmentParams.set(key, replacement);
        changed = true;
      }
    }
    if (changed) url.hash = fragmentParams.toString();
  }

  return url.toString();
}

/**
 * Returns a non-mutating clone that is safe to log or serialize. Circular
 * references and excessive depth are replaced with explicit markers.
 */
export function redactSensitive<T>(value: T, options: RedactionOptions = {}): T {
  const seen = new WeakSet<object>();
  const replacement = options.replacement ?? DEFAULT_REPLACEMENT;
  const maxDepth = clampInteger(options.maxDepth ?? 12, 1, 50);

  const visit = (current: unknown, depth: number, key?: string): unknown => {
    if (key && isSensitiveKey(key, options.sensitiveKeys)) return replacement;
    if (typeof current === "string") return redactText(current, options);
    if (current === null || typeof current !== "object") return current;
    if (depth >= maxDepth) return "[Truncated]";
    if (seen.has(current)) return "[Circular]";
    seen.add(current);

    if (current instanceof URL) return redactUrl(current, options);
    if (current instanceof Date) return new Date(current.getTime());
    if (current instanceof Error) return toSafeErrorDetails(current, options);
    if (Array.isArray(current)) return current.map((item) => visit(item, depth + 1));
    if (current instanceof Map) {
      return Object.fromEntries(
        [...current.entries()].map(([mapKey, mapValue]) => [String(mapKey), visit(mapValue, depth + 1, String(mapKey))])
      );
    }
    if (current instanceof Set) return [...current].map((item) => visit(item, depth + 1));
    if (typeof Headers !== "undefined" && current instanceof Headers) {
      return Object.fromEntries(
        [...current.entries()].map(([header, headerValue]) => [header, visit(headerValue, depth + 1, header)])
      );
    }

    const result: Record<string, unknown> = {};
    for (const [property, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
      if ("value" in descriptor) {
        result[property] = visit(descriptor.value, depth + 1, property);
      } else {
        result[property] = "[Accessor]";
      }
    }
    return result;
  };

  return visit(value, 0) as T;
}

export function toSafeErrorDetails(error: unknown, options: RedactionOptions = {}): SafeErrorDetails {
  if (!(error instanceof Error)) {
    return { name: "Error", message: redactText(String(error), options) };
  }

  const extended = error as Error & { code?: unknown; cause?: unknown };
  const details: SafeErrorDetails = {
    name: error.name || "Error",
    message: redactText(error.message, options)
  };
  if (error.stack) details.stack = redactText(error.stack, options);
  if (typeof extended.code === "string" || typeof extended.code === "number") {
    details.code = extended.code;
  }
  if (extended.cause !== undefined && extended.cause !== error) {
    details.cause = redactSensitive(extended.cause, options);
  }
  return details;
}

export function isSensitiveKey(key: string, additionalKeys: readonly string[] = []): boolean {
  const normalized = normalizeKey(key);
  if (DEFAULT_SENSITIVE_KEYS.has(normalized)) return true;
  if (additionalKeys.some((candidate) => normalizeKey(candidate) === normalized)) return true;
  return (
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("accesstoken") ||
    normalized.endsWith("refreshtoken") ||
    normalized.endsWith("privatekey")
  );
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
