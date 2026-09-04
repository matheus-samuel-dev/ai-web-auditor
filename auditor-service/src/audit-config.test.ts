import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuditConfiguration } from "./audit-config.js";

const baseRequest = {
  auditId: "123e4567-e89b-42d3-a456-426614174000",
  url: "https://example.com"
};

test("autorização precisa ser confirmada explicitamente", () => {
  assert.equal(resolveAuditConfiguration(baseRequest).authorizationConfirmed, false);
  assert.equal(resolveAuditConfiguration({ ...baseRequest, config: { authorizationConfirmed: true } }).authorizationConfirmed, true);
  assert.equal(resolveAuditConfiguration({ ...baseRequest, authorizationConfirmed: false }).authorizationConfirmed, false);
});

test("limites operacionais e viewports são normalizados", () => {
  const config = resolveAuditConfiguration({
    ...baseRequest,
    authorizationConfirmed: true,
    maxPages: 999,
    maxDepth: 999,
    timeoutSeconds: 9_999,
    viewports: [
      { id: "Desktop Premium", width: 9_999, height: 20, isMobile: false },
      "mobile"
    ]
  });

  assert.equal(config.maxPages, 30);
  assert.equal(config.maxDepth, 5);
  assert.equal(config.timeoutSeconds, 900);
  assert.deepEqual(config.viewports.map(({ id, width, height, isMobile }) => ({ id, width, height, isMobile })), [
    { id: "desktop-premium", width: 2560, height: 480, isMobile: false },
    { id: "mobile-390", width: 390, height: 844, isMobile: true }
  ]);
});
