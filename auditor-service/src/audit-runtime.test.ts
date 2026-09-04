import assert from "node:assert/strict";
import test from "node:test";
import {
  AuditCancelledError,
  cancelAllAudits,
  createAuditRuntime,
  finishAuditRuntime,
  getAuditRuntimeStatus
} from "./audit-runtime.js";

test("encerramento global cancela também auditorias que ainda estão em fila", async () => {
  const auditId = "123e4567-e89b-42d3-a456-426614174001";
  const runtime = createAuditRuntime(auditId, 30_000);

  assert.equal(getAuditRuntimeStatus(auditId)?.status, "QUEUED");
  assert.equal(cancelAllAudits("Encerramento de teste."), 1);
  assert.equal(getAuditRuntimeStatus(auditId)?.cancellationRequested, true);
  await assert.rejects(runtime.waitForSlot(), AuditCancelledError);

  finishAuditRuntime(auditId, "CANCELLED");
  assert.equal(getAuditRuntimeStatus(auditId)?.status, "CANCELLED");
});
