import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = process.env.VALIDATION_BASE_URL || 'http://localhost:5175';
const output = new URL('../storage/validation/', import.meta.url);
await fs.mkdir(output, { recursive: true });
let token;
async function api(path, body, expected = 200) {
  const r = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000)
  });
  const data = await r.json();
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
const session = await api('/auth/demo', {});
token = session.token;
assert.equal((await api('/auth/me')).id, session.user.id);
console.log('Demo JWT validado:', session.user.id);
for (const email of ['usuario@', 'usuario@dominio', '@dominio.com', 'usuario@@dominio.com', 'usuario dominio@gmail.com']) {
  for (const endpoint of ['register', 'login']) {
    const error = await api(`/auth/${endpoint}`, { name: 'Validação', email, password: 'Validation123!' }, 400);
    assert.ok(error.fieldErrors.email);
  }
}
console.log('10 rejeições de email HTTP 400 validadas');
for (const url of ['', 'https://', 'http://localhost', 'http://127.0.0.1', 'http://[::1]', 'http://10.0.0.1', 'http://192.168.0.1', 'http://172.16.0.1', 'http://169.254.169.254', 'http://metadata.google.internal', 'http://domain-does-not-exist.invalid']) {
  await api('/audits', { url, authorizationConfirmed: true }, 400);
}
console.log('URLs inválidas, DNS inexistente e SSRF rejeitados');
const ids = [];
for (let i = 0; i < 2; i++) {
  const created = await api('/audits', { url: 'https://example.com/', projectName: 'Demonstração — Example', auditMode: 'QUICK', maxPages: 1, timeoutSeconds: 180, aiEnabled: false, authorizationConfirmed: true }, 201);
  ids.push(created.id);
  console.log('CREATED', created.id);
  await fs.writeFile(new URL('live-ids.json', output), JSON.stringify(ids));
  const states = [];
  let report;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    report = await api(`/audits/${created.id}`);
    if (states.at(-1)?.stage !== report.currentStage || states.at(-1)?.status !== report.status) {
      states.push({ at: new Date().toISOString(), status: report.status, stage: report.currentStage, progress: report.progressPercent });
      console.log(created.id, report.status, report.currentStage, report.progressPercent);
    }
    if (!['RUNNING', 'PENDING'].includes(report.status)) break;
    for (const key of ['desktopScreenshotArtifact', 'mobileScreenshotArtifact', 'pdfArtifact']) {
      if (report[key].status !== 'AVAILABLE') assert.equal(report[key].url, null);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await fs.writeFile(new URL(`${created.id}.json`, output), JSON.stringify({ states, report }, null, 2));
  assert.equal(report.status, 'COMPLETED', report.failureReason);
  assert.equal(report.reportData.metadata.auditId, created.id);
  assert.equal(report.reportData.lighthouse.status, 'COMPLETED');
  for (const [name, endpoint] of [['desktop.png', 'screenshots/desktop'], ['mobile.png', 'screenshots/mobile'], ['report.pdf', 'pdf'], ['export.json', 'export/json']]) {
    const r = await fetch(`${base}/api/audits/${created.id}/${endpoint}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.ok(bytes.length > 50);
    if (name.endsWith('.png')) assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    if (name.endsWith('.pdf')) assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    if (name.endsWith('.json')) { const data = JSON.parse(bytes); assert.ok(JSON.stringify(data).includes(created.id)); assert.ok(!bytes.includes(Buffer.from(token))); }
    await fs.writeFile(new URL(`${created.id}-${name}`, output), bytes);
  }
  assert.ok(report.issues.length > 0);
  assert.ok(report.issues.every(issue => issue.type && issue.severity && issue.title && issue.description && issue.recommendation));
  console.log('ARTIFACTS + FINDINGS', report.issues.length, 'LIGHTHOUSE', report.reportData.lighthouse.scores, 'LINKS', report.brokenLinks);
  if (i === 1) { assert.equal(report.comparison.previousAuditId, ids[0]); console.log('COMPARISON', report.comparison); }
}
let combinations = 0;
for (const status of ['', 'COMPLETED', 'FAILED', 'RUNNING', 'PENDING']) {
  for (const search of ['', 'example', 'no-matching-audit-xyz']) {
    for (const sort of ['createdAt', 'overallScore', 'url']) {
      const params = new URLSearchParams({ page: '0', size: '1', search, sort, direction: 'asc', ...(status ? {status} : {}) });
      await api(`/audits/history?${params}`); combinations++;
    }
  }
}
await api('/audits/history?page=1&size=1&device=mobile&minimumScore=0&maximumScore=100');
console.log('HISTORY', combinations + 1, 'combinações HTTP 200');
console.log('DONE', JSON.stringify(ids));
