// Idempotent demo data provisioning: all reports come from actual public audits.
const base = (process.env.VALIDATION_BASE_URL || 'http://localhost:5175') + '/api';
async function call(path, body, token) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
  return result;
}
const {token} = await call('/auth/demo',{});
const history = await call('/audits',undefined,token);
const existing = history.filter(audit => audit.url.replace(/\/$/,'') === 'https://example.com');
if(existing.some(audit => ['PENDING','RUNNING'].includes(audit.status))) {
  throw new Error('Já existe uma demonstração em execução. Aguarde sua conclusão antes de repetir o seed.');
}
for(let count=existing.filter(audit=>audit.status==='COMPLETED').length;count<2;count++) {
  const audit = await call('/audits',{url:'https://example.com/',auditMode:'QUICK',maxPages:1,timeoutSeconds:180,
    viewports:[{name:'desktop',width:1440,height:900,mobile:false},{name:'mobile',width:390,height:844,mobile:true}],
    authorizationConfirmed:true,aiEnabled:false},token);
  console.log('Demonstração em execução:',audit.id);
  let complete=false;
  for(let poll=0;poll<100;poll++) {
    await new Promise(resolve=>setTimeout(resolve,2500));
    const report=await call(`/audits/${audit.id}`,undefined,token);
    if(report.status==='COMPLETED') {complete=true;break;}
    if(['FAILED','CANCELLED'].includes(report.status)) throw new Error(report.failureReason || 'Demonstração interrompida.');
  }
  if(!complete) throw new Error('O seed excedeu o prazo de acompanhamento; consulte o histórico antes de repetir.');
}
console.log('Conta demo pronta: pelo menos duas auditorias reais da mesma URL.');
