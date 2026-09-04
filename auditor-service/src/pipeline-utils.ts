import { AuditTimeoutError, throwIfAborted } from "./audit-runtime.js";

export interface EvidenceIdFactory {
  nextPage(): string;
  nextAction(): string;
  nextFinding(): string;
  nextScreenshot(): string;
  nextNetwork(): string;
}

export function createEvidenceIdFactory(): EvidenceIdFactory {
  const counters = {
    page: 0,
    action: 0,
    finding: 0,
    screenshot: 0,
    network: 0
  };
  const id = (prefix: string, value: number) => `${prefix}-${String(value).padStart(3, "0")}`;
  return {
    nextPage: () => id("PAGE", ++counters.page),
    nextAction: () => id("ACTION", ++counters.action),
    nextFinding: () => id("FINDING", ++counters.finding),
    nextScreenshot: () => id("SCREENSHOT", ++counters.screenshot),
    nextNetwork: () => id("NETWORK", ++counters.network)
  };
}

export async function runWithTimeout<T>(
  label: string,
  timeoutMs: number,
  parentSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  throwIfAborted(parentSignal);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new AuditTimeoutError(`A etapa "${label}" excedeu ${Math.round(timeoutMs / 1000)} segundos.`));
  }, Math.max(1, timeoutMs));

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason instanceof Error ? controller.signal.reason : new AuditTimeoutError()),
          { once: true }
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", onParentAbort);
  }
}

export async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const complete = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(complete, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Operação cancelada."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    timer.unref?.();
  });
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  callback: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (true) {
      throwIfAborted(signal);
      const index = cursor++;
      if (index >= items.length) {
        return;
      }
      results[index] = await callback(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function sanitizeForLog(value: unknown, maximumLength = 500): string {
  return String(value ?? "")
    .replace(/([?&](?:token|key|password|secret|authorization|code)=)[^&#\s]*/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .slice(0, maximumLength);
}
