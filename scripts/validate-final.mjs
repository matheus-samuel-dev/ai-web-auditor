import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base='http://localhost:5175/api';
const id=process.argv[2];
assert.match(id || '',/^[0-9a-f-]{36}$/i,'Informe o UUID de uma auditoria COMPLETED da conta demo.');
const root=new URL('../storage/validation/',import.meta.url);
let token;
async function api(path,body,expected=200) {
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;
}
// Exercise actual registration and login independently of the demo identity.
const email=`validation.${Date.now()}@example.com`;
const password=randomUUID();
const account=await api('/auth/register',{name:'Validação funcional',email,password},201);
token=account.token;assert.equal((await api('/auth/me')).email,email);
token=(await api('/auth/login',{email,password})).token;
assert.equal((await api('/auth/me')).id,account.user.id);
await api(`/audits/${id}`,undefined,404);
console.log('Real registration, password login and audit ownership passed');
token=(await api('/auth/demo',{})).token;
const report=await api(`/audits/${id}`);
assert.equal(report.status,'COMPLETED');assert.equal(report.reportData.metadata.auditId,id);
assert.equal(report.reportData.lighthouse.status,'COMPLETED');
await fs.writeFile(new URL(`${id}.json`,root),JSON.stringify({report},null,2));
for(const [name,path] of [['desktop.png','screenshots/desktop'],['mobile.png','screenshots/mobile'],['report.pdf','pdf'],['export.json','export/json']]) {
  const response=await fetch(`${base}/audits/${id}/${path}`,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
  if(name.endsWith('.json')) {const data=JSON.parse(bytes);assert.ok(JSON.stringify(data).includes(id));assert.ok(!bytes.includes(Buffer.from(token)));assert.ok(!bytes.includes(Buffer.from(password)));}
  await fs.writeFile(new URL(`${id}-${name}`,root),bytes);
}
// A missing physical file must never keep an AVAILABLE descriptor; restore it even on assertion failure.
const file=new URL(`../storage/reports/${id}/audit-report.pdf`,import.meta.url);
const backup=new URL(file.href+'.validation-backup');
await fs.rename(file,backup);
try {const missing=await api(`/audits/${id}`);assert.equal(missing.pdfArtifact.status,'UNAVAILABLE');assert.equal(missing.pdfArtifact.url,null);}
finally {await fs.rename(backup,file);}
assert.equal((await api(`/audits/${id}`)).pdfArtifact.status,'AVAILABLE');
console.log('Correct audit, actual downloads and missing-file consistency passed');
// Race cancel against the real worker's claim/progress updates, repeatedly.
const cancelled=[];
for(let attempt=0;attempt<5;attempt++) {
  const created=await api('/audits',{url:'http://fixture:4180/timeout',auditMode:'QUICK',maxPages:1,timeoutSeconds:30,aiEnabled:false,authorizationConfirmed:true},201);
  assert.equal((await api(`/audits/${created.id}`)).comparison,null);
  await api(`/audits/${created.id}/cancel`,{});
  const result=await api(`/audits/${created.id}`);
  assert.equal(result.status,'CANCELLED');assert.equal(result.mobileScreenshotArtifact.status,'CANCELLED');cancelled.push(created.id);
}
await new Promise(resolve=>setTimeout(resolve,1500));
for(const auditId of cancelled) assert.equal((await api(`/audits/${auditId}`)).status,'CANCELLED');
for(const status of ['PENDING','RUNNING','FAILED','CANCELLED','COMPLETED']) await api(`/audits/history?status=${status}&sort=overallScore&direction=desc&size=2&page=0`);
await fs.writeFile(new URL('final-checks.json',root),JSON.stringify({auditId:id,registration:true,downloads:true,missingFile:true,cancelled,comparison:report.comparison},null,2));
console.log('5 cancel/progress races, terminal persistence and history states passed');
