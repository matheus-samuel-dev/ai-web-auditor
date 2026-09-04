import type { AuditExecutionStatus, AuditRuntimeStatus } from "./types.js";

interface RuntimeRecord {
  controller: AbortController;
  status: AuditRuntimeStatus;
  releaseSlot?: () => void;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  retentionTimer?: ReturnType<typeof setTimeout>;
}

const records = new Map<string, RuntimeRecord>();
const configuredConcurrency = Number(process.env.AUDITOR_MAX_CONCURRENT_RUNS || 2);
const maximumConcurrentAudits = Number.isFinite(configuredConcurrency)
  ? Math.max(1, Math.min(8, Math.trunc(configuredConcurrency)))
  : 2;

export function createAuditRuntime(
  auditId: string,
  timeoutMs?: number
): { signal: AbortSignal; waitForSlot: () => Promise<void> } {
  const existing = records.get(auditId);
  if (existing && (existing.status.status === "QUEUED" || existing.status.status === "RUNNING")) {
    throw new Error(`A auditoria ${auditId} já está em execução.`);
  }

  if (existing?.retentionTimer) {
    clearTimeout(existing.retentionTimer);
  }

  const controller = new AbortController();
  const record: RuntimeRecord = {
    controller,
    status: {
      auditId,
      status: "QUEUED",
      progressPercent: 0,
      currentStage: "QUEUED",
      statusMessage: "Auditoria aguardando uma vaga de execução.",
      elapsedMs: 0,
      pagesVisited: 0,
      actionsExecuted: 0,
      findingsCount: 0,
      cancellationRequested: false
    }
  };
  if (Number.isFinite(timeoutMs) && Number(timeoutMs) > 0) {
    record.timeoutTimer = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(new AuditTimeoutError());
      }
    }, Number(timeoutMs));
    record.timeoutTimer.unref?.();
  }
  records.set(auditId, record);

  return {
    signal: controller.signal,
    waitForSlot: async () => {
      const release = await semaphore.acquire(controller.signal);
      record.releaseSlot = release;
      updateAuditRuntime(auditId, {
        status: "RUNNING",
        startedAt: new Date().toISOString(),
        currentStage: "VALIDATING_DOMAIN",
        statusMessage: "Validando domínio e política de segurança."
      });
    }
  };
}

export function updateAuditRuntime(
  auditId: string,
  patch: Partial<Omit<AuditRuntimeStatus, "auditId">>
): AuditRuntimeStatus | null {
  const record = records.get(auditId);
  if (!record) {
    return null;
  }

  record.status = {
    ...record.status,
    ...patch,
    auditId,
    elapsedMs: record.status.startedAt
      ? Math.max(0, Date.now() - Date.parse(record.status.startedAt))
      : record.status.elapsedMs
  };
  return cloneStatus(record.status);
}

export function finishAuditRuntime(
  auditId: string,
  status: Extract<AuditExecutionStatus, "COMPLETED" | "FAILED" | "CANCELLED">,
  error?: string
): void {
  const record = records.get(auditId);
  if (!record) {
    return;
  }

  record.releaseSlot?.();
  record.releaseSlot = undefined;
  if (record.timeoutTimer) {
    clearTimeout(record.timeoutTimer);
    record.timeoutTimer = undefined;
  }
  record.status = {
    ...record.status,
    status,
    progressPercent: status === "COMPLETED" ? 100 : record.status.progressPercent,
    currentStage: status,
    statusMessage:
      status === "COMPLETED"
        ? "Auditoria concluída."
        : status === "CANCELLED"
          ? "Auditoria cancelada."
          : "Auditoria falhou.",
    finishedAt: new Date().toISOString(),
    elapsedMs: record.status.startedAt
      ? Math.max(0, Date.now() - Date.parse(record.status.startedAt))
      : record.status.elapsedMs,
    error
  };

  record.retentionTimer = setTimeout(() => records.delete(auditId), 60 * 60 * 1000);
  record.retentionTimer.unref?.();
}

export function cancelAudit(auditId: string): AuditRuntimeStatus | null {
  const record = records.get(auditId);
  if (!record) {
    return null;
  }
  if (record.status.status === "COMPLETED" || record.status.status === "FAILED" || record.status.status === "CANCELLED") {
    return cloneStatus(record.status);
  }

  record.status.cancellationRequested = true;
  record.status.statusMessage = "Cancelamento solicitado; encerrando recursos com segurança.";
  record.controller.abort(new AuditCancelledError());
  return cloneStatus(record.status);
}

export function cancelAllAudits(message = "O auditor-service está encerrando."): number {
  let cancelled = 0;
  for (const record of records.values()) {
    if (record.status.status !== "QUEUED" && record.status.status !== "RUNNING") continue;
    record.status.cancellationRequested = true;
    record.status.statusMessage = message;
    if (!record.controller.signal.aborted) record.controller.abort(new AuditCancelledError(message));
    cancelled += 1;
  }
  return cancelled;
}

export function getAuditRuntimeStatus(auditId: string): AuditRuntimeStatus | null {
  const record = records.get(auditId);
  if (!record) {
    return null;
  }
  if (record.status.startedAt && !record.status.finishedAt) {
    record.status.elapsedMs = Math.max(0, Date.now() - Date.parse(record.status.startedAt));
  }
  return cloneStatus(record.status);
}

export function getAuditRuntimeSummary(): {
  maximumConcurrentAudits: number;
  queued: number;
  running: number;
} {
  const statuses = [...records.values()].map((record) => record.status.status);
  return {
    maximumConcurrentAudits,
    queued: statuses.filter((status) => status === "QUEUED").length,
    running: statuses.filter((status) => status === "RUNNING").length
  };
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  throw new AuditCancelledError();
}

export class AuditCancelledError extends Error {
  constructor(message = "A auditoria foi cancelada.") {
    super(message);
    this.name = "AuditCancelledError";
  }
}

export class AuditTimeoutError extends Error {
  constructor(message = "A auditoria excedeu o tempo limite global.") {
    super(message);
    this.name = "AuditTimeoutError";
  }
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<{
    resolve: (release: () => void) => void;
    reject: (error: unknown) => void;
    signal: AbortSignal;
    onAbort: () => void;
  }> = [];

  constructor(private readonly limit: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    if (this.active < this.limit) {
      this.active += 1;
      return this.releaseFactory();
    }

    return new Promise<() => void>((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) {
            this.queue.splice(index, 1);
          }
          reject(signal.reason instanceof Error ? signal.reason : new AuditCancelledError());
        }
      };
      signal.addEventListener("abort", entry.onAbort, { once: true });
      this.queue.push(entry);
    });
  }

  private releaseFactory(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.dispatch();
    };
  }

  private dispatch(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const next = this.queue.shift()!;
      next.signal.removeEventListener("abort", next.onAbort);
      if (next.signal.aborted) {
        next.reject(next.signal.reason);
        continue;
      }
      this.active += 1;
      next.resolve(this.releaseFactory());
    }
  }
}

const semaphore = new Semaphore(maximumConcurrentAudits);

function cloneStatus(status: AuditRuntimeStatus): AuditRuntimeStatus {
  return { ...status };
}
