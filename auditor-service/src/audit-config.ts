import type {
  AuditConfiguration,
  AuditMode,
  AuditRunRequest,
  AuditViewport,
  ResolvedAuditConfiguration
} from "./types.js";

const VIEWPORT_CATALOG: Record<string, AuditViewport> = {
  "mobile-360": { id: "mobile-360", label: "Mobile 360", width: 360, height: 800, isMobile: true },
  "mobile-390": { id: "mobile-390", label: "Mobile 390", width: 390, height: 844, isMobile: true },
  "mobile-414": { id: "mobile-414", label: "Mobile 414", width: 414, height: 896, isMobile: true },
  tablet: { id: "tablet", label: "Tablet", width: 768, height: 1024, isMobile: true },
  desktop: { id: "desktop", label: "Desktop", width: 1440, height: 900, isMobile: false }
};

const ALIASES: Record<string, string> = {
  mobile: "mobile-390",
  phone: "mobile-390",
  "360x800": "mobile-360",
  "390x844": "mobile-390",
  "414x896": "mobile-414",
  "768x1024": "tablet",
  "1440x900": "desktop"
};

export function resolveAuditConfiguration(request: AuditRunRequest): ResolvedAuditConfiguration {
  const nested = request.config ?? {};
  const value = <K extends keyof AuditConfiguration>(key: K): AuditConfiguration[K] | undefined =>
    request[key] ?? nested[key];

  const mode = normalizeMode(value("auditMode"));
  const isQuick = mode === "QUICK";
  const legacyTimeoutMs = finiteInteger(process.env.AUDITOR_TIMEOUT_MS, 0);
  const defaultTimeout = finiteInteger(
    process.env.AUDITOR_TIMEOUT_SECONDS,
    legacyTimeoutMs > 0 ? Math.ceil(legacyTimeoutMs / 1000) : isQuick ? 150 : 360
  );
  const timeoutSeconds = clampInteger(value("timeoutSeconds"), 30, 900, defaultTimeout);
  const stageTimeoutSeconds = clampInteger(
    value("stageTimeoutSeconds"),
    10,
    Math.min(180, timeoutSeconds),
    Math.min(90, timeoutSeconds)
  );

  const suppliedViewports = value("viewports");
  const defaults = isQuick
    ? [VIEWPORT_CATALOG.desktop, VIEWPORT_CATALOG["mobile-390"]]
    : [
        VIEWPORT_CATALOG["mobile-360"],
        VIEWPORT_CATALOG["mobile-390"],
        VIEWPORT_CATALOG["mobile-414"],
        VIEWPORT_CATALOG.tablet,
        VIEWPORT_CATALOG.desktop
      ];

  return {
    auditMode: mode,
    maxPages: clampInteger(value("maxPages"), 1, 30, isQuick ? 1 : 10),
    maxDepth: clampInteger(value("maxDepth"), 0, 5, isQuick ? 0 : 2),
    timeoutSeconds,
    stageTimeoutSeconds,
    concurrency: clampInteger(value("concurrency"), 1, 6, finiteInteger(process.env.AUDITOR_CONCURRENCY, 2)),
    include: normalizeStringList(value("include"), 30),
    exclude: normalizeStringList(value("exclude"), 30),
    viewports: normalizeViewports(suppliedViewports, defaults),
    authorizationConfirmed: value("authorizationConfirmed") === true,
    testEnvironment: value("testEnvironment") === true,
    allowDestructiveActions: value("allowDestructiveActions") === true,
    aiEnabled: value("aiEnabled") !== false,
    authConfig: normalizeAuthConfig(value("authConfig")),
    scenarios: normalizeScenarios(value("scenarios"))
  };
}

function normalizeAuthConfig(raw: AuditConfiguration["authConfig"] | undefined) {
  if (!raw || typeof raw !== "object") return null;
  const loginUrl = boundedString(raw.loginUrl, 2_048);
  if (!loginUrl) return null;
  return {
    loginUrl,
    username: boundedString(raw.username, 500) || undefined,
    password: boundedString(raw.password, 2_000) || undefined,
    usernameSelector: boundedString(raw.usernameSelector, 500) || undefined,
    passwordSelector: boundedString(raw.passwordSelector, 500) || undefined,
    submitSelector: boundedString(raw.submitSelector, 500) || undefined,
    expectedUrl: boundedString(raw.expectedUrl, 2_048) || undefined,
    expectedSelector: boundedString(raw.expectedSelector, 500) || undefined
  };
}

function normalizeScenarios(raw: AuditConfiguration["scenarios"] | undefined) {
  if (!Array.isArray(raw)) return [];
  const allowedActions = new Set(["navigate", "click", "fill", "select", "check", "assert", "press"]);
  return raw.slice(0, 20).flatMap((scenario, scenarioIndex) => {
    if (!scenario || typeof scenario !== "object") return [];
    const name = boundedString(scenario.name, 120) || `Cenário ${scenarioIndex + 1}`;
    const steps = Array.isArray(scenario.steps)
      ? scenario.steps.slice(0, 50).flatMap((step) => {
          if (!step || typeof step !== "object") return [];
          const action = String(step.action || "").toLowerCase();
          if (!allowedActions.has(action)) return [];
          return [{
            action: action as "navigate" | "click" | "fill" | "select" | "check" | "assert" | "press",
            target: boundedString(step.target, 500) || undefined,
            value: boundedString(step.value, 2_000) || undefined,
            expected: boundedString(step.expected, 2_000) || undefined
          }];
        })
      : [];
    return [{
      id: sanitizeId(boundedString(scenario.id, 80) || `scenario-${scenarioIndex + 1}`),
      name,
      description: boundedString(scenario.description, 500) || undefined,
      steps
    }];
  });
}

function boundedString(value: unknown, maximumLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

export function getDefaultViewportCatalog(): AuditViewport[] {
  return Object.values(VIEWPORT_CATALOG).map((viewport) => ({ ...viewport }));
}

function normalizeMode(raw: AuditConfiguration["auditMode"] | undefined): AuditMode {
  const value = String(raw ?? "QUICK").trim().toUpperCase();
  if (value === "FULL" || value === "AUTHENTICATED" || value === "GUIDED") {
    return value;
  }
  return "QUICK";
}

function normalizeViewports(
  raw: AuditConfiguration["viewports"] | undefined,
  defaults: AuditViewport[]
): AuditViewport[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return defaults.map((viewport) => ({ ...viewport }));
  }

  const result: AuditViewport[] = [];
  for (const item of raw.slice(0, 8)) {
    if (typeof item === "string") {
      const key = ALIASES[item.trim().toLowerCase()] ?? item.trim().toLowerCase();
      const known = VIEWPORT_CATALOG[key];
      if (known) {
        result.push({ ...known });
      }
      continue;
    }

    if (!item || typeof item !== "object") {
      continue;
    }
    const width = clampInteger(item.width, 320, 2560, 390);
    const height = clampInteger(item.height, 480, 1600, 844);
    const suggestedId = item.id || `${width}x${height}`;
    const id = sanitizeId(suggestedId);
    result.push({
      id,
      label: String(item.label || id).slice(0, 60),
      width,
      height,
      isMobile: item.isMobile ?? width < 900
    });
  }

  return deduplicateViewports(result.length > 0 ? result : defaults);
}

function deduplicateViewports(viewports: AuditViewport[]): AuditViewport[] {
  const seen = new Set<string>();
  return viewports.filter((viewport) => {
    const key = `${viewport.width}x${viewport.height}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, max);
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "viewport";
}

function finiteInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return Math.min(maximum, Math.max(minimum, finiteInteger(value, fallback)));
}
