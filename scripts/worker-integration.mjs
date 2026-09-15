// Run inside the auditor image, with this directory mounted read-only at /validation.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const { chromium } = await import('/app/node_modules/playwright/index.mjs');
const { runAudit, __testing } = await import('/app/dist/audit-runner.js');
const { runLighthouseAudit } = await import('/app/dist/lighthouse-audit.js');
const { assertSafeAuditUrl, fetchWithSsrfGuard } = await import('/app/dist/lib/ssrf-guard.js');
const { createEvidenceIdFactory } = await import('/app/dist/pipeline-utils.js');
const { resolveAuditConfiguration } = await import('/app/dist/audit-config.js');
const options = { environment: 'production', privateHostAllowlist: ['fixture'] };
const signal = () => new AbortController().signal;
const request = (url = 'http://fixture:4180/head-rejected') => ({ auditId: randomUUID(), url, auditMode: 'QUICK', maxPages: 1, timeoutSeconds: 120, stageTimeoutSeconds: 45, aiEnabled: false, authorizationConfirmed: true });

test('SSRF blocks loopback, private, metadata and redirected requests before transport', async () => {
  for (const url of ['http://localhost', 'http://127.0.0.1', 'http://[::1]', 'http://10.0.0.1', 'http://169.254.169.254', 'http://metadata.google.internal']) {
    await assert.rejects(assertSafeAuditUrl(url, options));
  }
  await assert.rejects(fetchWithSsrfGuard('http://fixture:4180/redirect-private', {}, options));
  let hits = 0;
  const target = http.createServer((req, res) => { hits++; res.end('<h1>PRIVATE</h1>'); });
  await new Promise(resolve => target.listen(8080, '127.0.0.1', resolve));
  try {
    await assert.rejects(runAudit(request('http://fixture:4180/redirect-private')));
    assert.equal(hits, 0, 'Chromium must not follow a redirect to a private endpoint');
    const lighthouse = await runLighthouseAudit('http://fixture:4180/redirect-private', 20000, signal(), url => assertSafeAuditUrl(url, options));
    assert.equal(lighthouse.status, 'FAILED');
    assert.equal(hits, 0, 'Lighthouse must not connect to redirected private endpoints');
  } finally { await new Promise(resolve => target.close(resolve)); }
});

test('real link checker retries HEAD as GET, records 404, and does not invent HTTP 599', async () => {
  const browser = { linkCandidates: ['head-rejected', 'broken'].map(path => ({ url: `http://fixture:4180/${path}`, pageId: 'PAGE-001' })).concat([{url:'http://fixture:4999',pageId:'PAGE-001'}]), coverage: {} };
  const results = await __testing.checkBrokenLinks(browser, resolveAuditConfiguration(request()), options, signal(), createEvidenceIdFactory());
  assert.ok(!results.some(r => r.url.includes('head-rejected')));
  assert.equal(results.find(r => r.url.includes('broken')).statusCode, 404);
  assert.equal(results.find(r => r.url.includes('4999')).statusCode, 0);
  assert.equal(browser.coverage.linksChecked, 2);
});

test('Playwright launch failure reaches terminal failure and returns cleanly', async () => {
  const launch = chromium.launch;
  chromium.launch = () => Promise.reject(new Error('Controlled Chromium launch failure'));
  try { await assert.rejects(runAudit(request()), /Controlled Chromium/); }
  finally { chromium.launch = launch; }
});

test('connection refused cannot produce a completed audit', async () => {
  await assert.rejects(runAudit(request('http://fixture:4999')), /Nenhuma página/);
});

test('Lighthouse timeout is isolated, runtime errors are not marked completed', async () => {
  const timeout = await runLighthouseAudit('http://fixture:4180/timeout', 50, signal(), url => assertSafeAuditUrl(url, options));
  assert.equal(timeout.status, 'FAILED');
  assert.equal(timeout.scores.performance, null);
  const failed = await runLighthouseAudit('http://fixture:4999', 20000, signal(), url => assertSafeAuditUrl(url, options));
  assert.equal(failed.status, 'FAILED');
});

test('mobile screenshot failure preserves desktop, real Lighthouse, JSON and PDF', async () => {
  const launch = chromium.launch;
  let closed = false;
  chromium.launch = async (...args) => {
    const browser = await launch.apply(chromium, args);
    const close = browser.close.bind(browser);
    browser.close = async (...args) => { await close(...args); closed = true; };
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext(options);
      if (options?.isMobile) {
        const newPage = context.newPage.bind(context);
        context.newPage = async () => {
          const page = await newPage();
          page.screenshot = async () => { throw new Error('Controlled mobile screenshot failure'); };
          return page;
        };
      }
      return context;
    };
    return browser;
  };
  try {
    const req = request();
    const result = await runAudit(req);
    assert.equal(result.reportData.metadata.auditId, req.auditId);
    assert.equal(result.mobileScreenshotPath, '');
    assert.ok(result.desktopScreenshotPath);
    assert.equal(result.reportData.lighthouse.status, 'COMPLETED');
    for (const file of [result.desktopScreenshotPath, result.reportPdfPath, result.reportJsonPath]) {
      assert.ok((await fs.stat(`/workspace/storage/${file}`)).size > 50);
    }
    assert.ok(result.reportData.limitations.some(item => item.includes('mobile')));
    assert.ok(closed);
  } finally { chromium.launch = launch; }
});
