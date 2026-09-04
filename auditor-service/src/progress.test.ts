import assert from "node:assert/strict";
import test from "node:test";
import { resolveAllowedCallbackUrl } from "./progress.js";

const auditId = "123e4567-e89b-42d3-a456-426614174000";
const progressUrl = `http://backend:8080/api/internal/audits/${auditId}/progress`;

test("callback aceita somente endpoint e origem explicitamente permitidos", () => {
  assert.equal(resolveAllowedCallbackUrl(progressUrl, auditId, ["http://backend:8080"])?.toString(), progressUrl);
  assert.equal(resolveAllowedCallbackUrl(progressUrl, auditId, ["http://backend:8081"]), null);
  assert.equal(resolveAllowedCallbackUrl(progressUrl, auditId, ["auditor-service"]), null);
});

test("callback rejeita credenciais, query, fragmento e caminho divergente", () => {
  assert.equal(resolveAllowedCallbackUrl(
    `http://user:secret@backend:8080/api/internal/audits/${auditId}/progress`,
    auditId,
    ["http://backend:8080"]
  ), null);
  assert.equal(resolveAllowedCallbackUrl(`${progressUrl}?next=http://metadata`, auditId, ["http://backend:8080"]), null);
  assert.equal(resolveAllowedCallbackUrl(`${progressUrl}#token`, auditId, ["http://backend:8080"]), null);
  assert.equal(resolveAllowedCallbackUrl(`http://backend:8080/api/internal/audits/${auditId}`, auditId, ["http://backend:8080"]), null);
});

test("callback não permite curingas na allowlist", () => {
  assert.equal(resolveAllowedCallbackUrl(progressUrl, auditId, ["*.internal"]), null);
});
