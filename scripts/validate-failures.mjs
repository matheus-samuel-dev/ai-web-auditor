import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const root = new URL('../storage/validation/', import.meta.url);
const base = 'http://localhost:5175/api';
const session = await fetch(`${base}/auth/demo`, { method: 'POST' }).then(r => r.json());
const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
async function api(path, body, status=200) {
  const r = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const data = await r.json(); assert.equal(r.status,status,JSON.stringify(data)); return data;
}
async function create(url, timeoutSeconds=90) {
  const audit = await api('/audits', {url, auditMode:'QUICK', maxPages:1, timeoutSeconds, aiEnabled:false, authorizationConfirmed:true, viewports:[{name:'desktop',width:1440,height:900,mobile:false},{name:'mobile',width:390,height:844,mobile:true}]},201);
  console.log('CREATED',url,audit.id); return audit.id;
}
async function wait(id) {
  const states=[]; let report;
  for (let n=0;n<150;n++) {
    report=await api(`/audits/${id}`);
    if (states.at(-1)?.stage!==report.currentStage || states.at(-1)?.status!==report.status) { states.push({status:report.status,stage:report.currentStage,progress:report.progressPercent}); console.log(id,report.status,report.currentStage); }
    if (!['PENDING','RUNNING'].includes(report.status)) {
      await fs.writeFile(new URL(`${id}.json`,root),JSON.stringify({states,report},null,2)); return report;
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error(`Audit stuck: ${id}`);
}
const resume = process.argv.includes('--resume');
const ids=resume ? JSON.parse(await fs.readFile(new URL('failure-ids.json',root),'utf8')) : {};
if (!resume) {
try {
  execFileSync('docker',['compose','stop','auditor-service'],{stdio:'pipe'});
  ids.retry=await create('https://example.com/');
  const failed=await wait(ids.retry);
  assert.equal(failed.status,'FAILED'); assert.ok(/offline|indisponível|conexão/.test(failed.failureReason));
} finally { execFileSync('docker',['compose','start','auditor-service'],{stdio:'pipe'}); }
// A started container is not ready yet; wait for its actual healthcheck.
let healthy=false;
for(let attempt=0;attempt<60;attempt++) {
  if(execFileSync('docker',['inspect','--format','{{.State.Health.Status}}','ai-web-auditor-service'],{encoding:'utf8'}).trim()==='healthy') {healthy=true;break;}
  await new Promise(resolve=>setTimeout(resolve,1000));
}
assert.ok(healthy,'auditor-service must be healthy before retry');
await api(`/audits/${ids.retry}/retry`,{});
const reset=await api(`/audits/${ids.retry}`);
assert.equal(reset.overallScore,null); assert.deepEqual(reset.issues,[]);
assert.equal(reset.desktopScreenshotArtifact.status,'GENERATING');
assert.equal(reset.pdfArtifact.status,'GENERATING');
assert.equal((await wait(ids.retry)).status,'COMPLETED');
console.log('RETRY passed');
}
for (const [label,url,expected,timeout] of [
  ['refused','http://fixture:4999','FAILED',30],
  ['timeout','http://fixture:4180/timeout','FAILED',30],
  ['redirect-private','http://fixture:4180/redirect-private','FAILED',30],
  ['http404','http://fixture:4180/broken','COMPLETED',60],
  ['http500','http://fixture:4180/api/error','COMPLETED',60],
  ['fixture','http://fixture:4180/','COMPLETED',150],
]) {
  if (resume && !['http500','fixture'].includes(label)) continue;
  ids[label]=await create(url,timeout);
  await fs.writeFile(new URL('failure-ids.json',root),JSON.stringify(ids,null,2));
  const report=await wait(ids[label]); assert.equal(report.status,expected,report.failureReason);
  if(expected==='FAILED') assert.ok(report.failureReason && !report.failureReason.includes(' at '));
  if(label==='http404'||label==='http500') {
    assert.ok(report.reportData.networkErrors.some(e=>e.statusCode===(label==='http404'?404:500)));
    assert.equal(report.reportData.lighthouse.status,'FAILED');
    assert.equal(report.desktopScreenshotArtifact.status,'AVAILABLE');
  }
  if(label==='fixture') {
    assert.ok(report.brokenLinks.some(link=>link.statusCode===404));
    assert.ok(report.consoleErrors.length>0);
    if (report.comparison) assert.equal((await api(`/audits/${report.comparison.previousAuditId}`)).url,report.url,'different URLs must not be compared');
    console.log('FIXTURE',report.issues.length,report.brokenLinks.length,report.consoleErrors.length);
  }
}
ids.cancel=await create('http://fixture:4180/timeout',30);
await api(`/audits/${ids.cancel}/cancel`,{});
const cancelled=await api(`/audits/${ids.cancel}`);
assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.mobileScreenshotArtifact.status,'CANCELLED');
for (const state of ['COMPLETED','FAILED','RUNNING','PENDING','CANCELLED']) await api(`/audits/history?status=${state}&search=&size=2&page=0&sort=overallScore&direction=desc`);
await fs.writeFile(new URL('failure-ids.json',root),JSON.stringify(ids,null,2));
console.log('ALL FAILURE TESTS PASSED',ids);
