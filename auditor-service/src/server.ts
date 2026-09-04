import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { runAudit } from "./audit-runner.js";
import {
  AuditCancelledError,
  AuditTimeoutError,
  cancelAllAudits,
  cancelAudit,
  getAuditRuntimeStatus,
  getAuditRuntimeSummary
} from "./audit-runtime.js";
import { redactText } from "./lib/redaction.js";
import type { AuditRunRequest } from "./types.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const auditorApiToken = process.env.AUDITOR_API_TOKEN?.trim();
const developmentMode = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

if (!auditorApiToken && !developmentMode) {
  throw new Error("AUDITOR_API_TOKEN é obrigatório fora do ambiente de desenvolvimento.");
}

app.disable("x-powered-by");
app.use(cors({ origin: false }));
app.use(express.json({ limit: "256kb", strict: true }));
app.use((request, response, next) => {
  if (request.path === "/health") {
    next();
    return;
  }
  const startedAt = Date.now();
  console.info(`[server] ${request.method} ${request.path} iniciado.`);
  response.on("finish", () => {
    console.info(
      `[server] ${request.method} ${request.path} finalizado com status ${response.statusCode} em ${Date.now() - startedAt} ms.`
    );
  });
  next();
});

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "auditor-service",
    timestamp: new Date().toISOString(),
    runtime: getAuditRuntimeSummary()
  });
});

app.post("/api/audits/run", requireInternalToken, async (request, response) => {
  const body = request.body as Partial<AuditRunRequest>;
  if (!isUuid(body.auditId) || typeof body.url !== "string" || body.url.trim().length === 0) {
    response.status(400).json({
      message: "auditId deve ser um UUID válido e url é obrigatória."
    });
    return;
  }
  const auditId = body.auditId;
  const targetUrl = body.url;

  let executionSettled = false;
  const cancelOnDisconnect = () => {
    if (!executionSettled && !response.writableEnded) {
      console.warn(`[server] Cliente desconectou durante a auditoria ${auditId}; cancelamento solicitado.`);
      cancelAudit(auditId);
    }
  };
  request.once("aborted", cancelOnDisconnect);
  response.once("close", cancelOnDisconnect);

  try {
    // Spread is intentional: it preserves root-level migration fields while the
    // runner also understands the preferred nested `config` object.
    const result = await runAudit({ ...body, auditId, url: targetUrl });
    if (!response.destroyed && !response.writableEnded) response.json(result);
  } catch (error) {
    const message = redactText(error instanceof Error ? error.message : "Falha ao executar a auditoria.").slice(0, 500);
    const status =
      error instanceof AuditCancelledError
        ? 409
        : error instanceof AuditTimeoutError
          ? 408
          : /já está em execução/i.test(message)
            ? 409
            : 422;
    console.error(`[server] Auditoria ${auditId} terminou com erro: ${safeErrorName(error)}.`);
    if (!response.destroyed && !response.writableEnded) response.status(status).json({ message });
  } finally {
    executionSettled = true;
    request.removeListener("aborted", cancelOnDisconnect);
    response.removeListener("close", cancelOnDisconnect);
  }
});

app.get("/api/audits/:auditId/status", requireInternalToken, (request, response) => {
  if (!isUuid(request.params.auditId)) {
    response.status(400).json({ message: "auditId inválido." });
    return;
  }
  const status = getAuditRuntimeStatus(request.params.auditId);
  if (!status) {
    response.status(404).json({ message: "Execução não encontrada neste processo." });
    return;
  }
  response.json(status);
});

app.post("/api/audits/:auditId/cancel", requireInternalToken, (request, response) => {
  if (!isUuid(request.params.auditId)) {
    response.status(400).json({ message: "auditId inválido." });
    return;
  }
  const status = cancelAudit(request.params.auditId);
  if (!status) {
    response.status(404).json({ message: "Execução não encontrada neste processo." });
    return;
  }
  response.status(202).json(status);
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof SyntaxError) {
    response.status(400).json({ message: "Corpo JSON inválido." });
    return;
  }
  console.error(`[server] Erro HTTP não tratado: ${safeErrorName(error)}.`);
  response.status(500).json({ message: "Erro interno do auditor-service." });
});

const server = app.listen(port, () => {
  console.info(`[server] auditor-service disponível na porta ${port}.`);
});

let shutdownStarted = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.info(`[server] ${signal} recebido; interrompendo novas chamadas e encerrando auditorias ativas.`);
  const cancelled = cancelAllAudits("O auditor-service está encerrando; a auditoria foi cancelada com segurança.");
  console.info(`[server] Cancelamento solicitado para ${cancelled} auditoria(s).`);

  const forceTimer = setTimeout(() => {
    console.error("[server] Encerramento gracioso excedeu 25 segundos; conexões remanescentes serão fechadas.");
    server.closeAllConnections?.();
    process.exitCode = 1;
  }, 25_000);
  forceTimer.unref?.();

  server.close((error) => {
    clearTimeout(forceTimer);
    if (error) {
      console.error(`[server] Falha ao fechar servidor HTTP: ${safeErrorName(error)}.`);
      process.exitCode = 1;
    } else {
      console.info("[server] Servidor HTTP encerrado com segurança.");
    }
  });
  server.closeIdleConnections?.();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

function requireInternalToken(request: Request, response: Response, next: NextFunction): void {
  if (auditorApiToken && !constantTimeTokenEquals(auditorApiToken, request.header("X-Auditor-Api-Token"))) {
    response.status(401).json({ message: "Chamada interna não autorizada." });
    return;
  }
  next();
}

function constantTimeTokenEquals(expected: string, supplied: string | undefined): boolean {
  if (!supplied) return false;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
