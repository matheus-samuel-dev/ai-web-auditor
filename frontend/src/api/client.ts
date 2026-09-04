import type {
  ApiError,
  AuditIssue,
  AuditListItem,
  AuditProject,
  AuditReport,
  AuthResponse,
  CreateAuditPayload,
  DashboardSummary,
  ResolutionStatus,
  User
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
const TOKEN_KEY = "ai-web-auditor-token";
export const REQUEST_TIMEOUT_MS = 15_000;
export const ASSET_TIMEOUT_MS = 25_000;

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);

  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  try {
    return await runWithTimeout(async (signal) => {
      const response = await fetch(resolveApiUrl(path), { ...options, headers, signal });

      if (!response.ok) {
        const payload = await safeJson(response);
        const error = new Error(payload?.message || "Não foi possível concluir a requisição.") as ApiError;
        error.status = response.status;
        error.fieldErrors = payload?.fieldErrors;
        if (response.status === 401 && token) {
          setStoredToken(null);
          window.dispatchEvent(new CustomEvent("aiwa:session-expired"));
        }
        throw error;
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return response.json() as Promise<T>;
    }, options.signal, REQUEST_TIMEOUT_MS);
  } catch (requestError) {
    throw normalizeConnectionError(requestError);
  }
}

export async function fetchAsset(path: string, signal?: AbortSignal): Promise<Blob> {
  const token = getStoredToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  try {
    return await runWithTimeout(async (requestSignal) => {
      const response = await fetch(resolveApiUrl(path), { signal: requestSignal, headers });
      if (response.status !== 200) {
        const payload = await safeJson(response);
        const error = new Error(payload?.message || "Não foi possível carregar o artefato da auditoria.") as ApiError;
        error.status = response.status;
        error.fieldErrors = payload?.fieldErrors;
        if (response.status === 401) {
          setStoredToken(null);
          window.dispatchEvent(new CustomEvent("aiwa:session-expired"));
        }
        throw error;
      }
      return response.blob();
    }, signal, ASSET_TIMEOUT_MS);
  } catch (requestError) {
    throw normalizeConnectionError(requestError, "Não foi possível conectar ao servidor para carregar este artefato.");
  }
}

export function resolveApiUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith("/api")) return `${API_ORIGIN}${path}`;
  return `${API_BASE_URL.replace(/\/$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function runWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  externalSignal: AbortSignal | null | undefined,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let rejectCancellation: (reason: unknown) => void = () => undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const abortFromCaller = () => {
    const reason = externalSignal?.reason instanceof Error
      ? externalSignal.reason
      : new DOMException("A requisição foi cancelada.", "AbortError");
    controller.abort(reason);
    rejectCancellation(reason);
  };

  if (externalSignal?.aborted) {
    abortFromCaller();
  } else {
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutId = globalThis.setTimeout(() => {
    const error = new Error("O servidor demorou demais para responder. Tente novamente em instantes.") as ApiError;
    error.status = 408;
    controller.abort(error);
    rejectCancellation(error);
  }, timeoutMs);

  try {
    return await Promise.race([operation(controller.signal), cancellation]);
  } finally {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function normalizeConnectionError(error: unknown, fallback = "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.") {
  if (error instanceof Error && error.name === "AbortError") return error;
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return error;
  if (error instanceof Error && "status" in error) return error;
  const apiError = new Error(fallback) as ApiError;
  apiError.status = 0;
  return apiError;
}

export const authApi = {
  login: (email: string, password: string, options?: RequestInit) =>
    request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }), ...options }),
  register: (name: string, email: string, password: string, options?: RequestInit) =>
    request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
      ...options
    }),
  me: (options?: RequestInit) => request<User>("/auth/me", options)
};

export const auditApi = {
  create: (payload: string | CreateAuditPayload, options?: RequestInit) =>
    request<AuditListItem>("/audits", {
      method: "POST",
      body: JSON.stringify(typeof payload === "string" ? { url: payload, authorizationConfirmed: true } : payload),
      ...options
    }),
  dashboard: (options?: RequestInit) => request<DashboardSummary>("/audits/dashboard", options),
  list: (options?: RequestInit) => request<AuditListItem[]>("/audits", options),
  getById: (id: string, options?: RequestInit) => request<AuditReport>(`/audits/${id}`, options),
  cancel: (id: string) => request<AuditListItem>(`/audits/${id}/cancel`, { method: "POST" }),
  retry: (id: string) => request<AuditListItem>(`/audits/${id}/retry`, { method: "POST" }),
  remove: (id: string) => request<void>(`/audits/${id}`, { method: "DELETE" }),
  updateFinding: (
    auditId: string,
    findingId: string,
    payload: { resolutionStatus: ResolutionStatus; resolutionComment?: string }
  ) =>
    request<AuditIssue>(`/audits/${auditId}/findings/${findingId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    })
};

export const projectApi = {
  list: (options?: RequestInit) => request<AuditProject[]>("/projects", options),
  create: (
    payload: Pick<AuditProject, "name" | "url" | "environment"> &
      Partial<AuditProject> & { authorizationConfirmed: boolean }
  ) =>
    request<AuditProject>("/projects", { method: "POST", body: JSON.stringify(payload) }),
  update: (id: string, payload: Partial<AuditProject>) =>
    request<AuditProject>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  archive: (id: string) => request<AuditProject>(`/projects/${id}/archive`, { method: "PATCH" }),
  setBaseline: (id: string, auditId: string) =>
    request<AuditProject>(`/projects/${id}/baseline/${auditId}`, { method: "PUT" })
};
