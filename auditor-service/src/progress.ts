import type { AuditProgressUpdatePayload, AuditRunRequest } from "./types.js";

export async function reportAuditProgress(
  request: AuditRunRequest,
  payload: AuditProgressUpdatePayload
): Promise<void> {
  if (!request.callbackUrl || !request.callbackToken) {
    return;
  }

  const callbackUrl = resolveAllowedCallbackUrl(request.callbackUrl, request.auditId);
  if (!callbackUrl) {
    console.warn(`[audit:${request.auditId}] Callback de progresso ignorado por não corresponder à allowlist interna.`);
    return;
  }

  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "X-Audit-Callback-Token": request.callbackToken
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      console.warn(
        `[audit:${request.auditId}] Callback de progresso rejeitado com status ${response.status} na etapa ${payload.currentStage}.`
      );
    }
  } catch {
    console.warn(
      `[audit:${request.auditId}] Falha ao enviar callback de progresso para a etapa ${payload.currentStage}.`
    );
    return;
  }
}

/**
 * Accepts only the exact progress endpoint for this audit on explicitly
 * allowlisted hosts/origins. Wildcards, credentials, query strings and
 * fragments are deliberately unsupported.
 */
export function resolveAllowedCallbackUrl(
  rawCallbackUrl: string,
  auditId: string,
  allowedRules: readonly string[] = callbackHostAllowlist()
): URL | null {
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(rawCallbackUrl);
  } catch {
    return null;
  }

  if (
    !/^https?:$/.test(callbackUrl.protocol) ||
    callbackUrl.username ||
    callbackUrl.password ||
    callbackUrl.search ||
    callbackUrl.hash ||
    callbackUrl.pathname !== `/api/internal/audits/${auditId}/progress`
  ) {
    return null;
  }

  return allowedRules.some((rule) => matchesAllowedCallbackRule(callbackUrl, rule)) ? callbackUrl : null;
}

function callbackHostAllowlist(): string[] {
  return String(process.env.AUDITOR_ALLOWED_CALLBACK_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function matchesAllowedCallbackRule(callbackUrl: URL, rawRule: string): boolean {
  const rule = rawRule.trim().toLowerCase();
  if (!rule || rule.includes("*")) return false;

  if (/^https?:\/\//.test(rule)) {
    try {
      const allowedOrigin = new URL(rule);
      return allowedOrigin.pathname === "/" && callbackUrl.origin.toLowerCase() === allowedOrigin.origin.toLowerCase();
    } catch {
      return false;
    }
  }

  if (/[/?#]/.test(rule)) return false;

  return rule.includes(":")
    ? callbackUrl.host.toLowerCase() === rule
    : callbackUrl.hostname.toLowerCase() === rule;
}
