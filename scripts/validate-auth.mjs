import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.AUTH_BASE_URL || 'http://localhost:5175';
const email=process.env.AUTH_EXISTING_EMAIL;
const password=process.env.AUTH_TEST_PASSWORD;
assert.ok(email && password,'Informe AUTH_EXISTING_EMAIL e AUTH_TEST_PASSWORD no ambiente.');
const before=process.argv.includes('--before');
const evidence=[];
async function call(path,body,status,{origin=base,token,method=body===undefined?'GET':'POST'}={}) {
  const start=performance.now();
  const response=await fetch(base+'/api'+path,{method,headers:{...(origin?{Origin:origin}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  evidence.push({path,method,payload:body?{...body,...('password' in body?{password:'[REDACTED]'}:{})}:null,origin,httpStatus:response.status,durationMs:Math.round(performance.now()-start),response:typeof data==='object'?{...data,...(data.token?{token:'[REDACTED]'}:{})}:data});
  assert.equal(response.status,status,`${path}: ${response.status} ${typeof data==='string'?data:data.message||''}`);
  return data;
}
try {
  if(before) {
    await call('/auth/login',{email,password},403);
    await call('/auth/demo',{},403);
    await call('/auth/register',{name:'Reprodução CORS',email:`cors.${Date.now()}@example.com`,password},403);
    const direct=await call('/auth/login',{email,password},200,{origin:null});
    await call('/auth/me',undefined,200,{origin:null,token:direct.token});
    console.log('BEFORE: Origin HTTPS = 403; mesmas credenciais sem Origin = 200.');
  } else {
    const session=await call('/auth/login',{email,password},200);
    assert.equal((await call('/auth/me',undefined,200,{token:session.token})).id,session.user.id);
    await call('/auth/login',{email,password:'definitely-wrong-password'},401);
    await call('/auth/login',{email:`missing.${Date.now()}@example.com`,password},401);
    await call('/auth/me',undefined,403);
    await call('/auth/me',undefined,403,{token:'invalid-token'});
    await call('/auth/login',{email,password},200,{token:'invalid-old-token'});
    const newEmail=`auth.validation.${Date.now()}@example.com`;
    const created=await call('/auth/register',{name:'Validação autenticação',email:newEmail,password},201);
    assert.equal((await call('/auth/me',undefined,200,{token:created.token})).email,newEmail);
    assert.equal((await call('/auth/login',{email:newEmail,password},200)).user.id,created.user.id);
    await call('/auth/register',{name:'Duplicado',email:newEmail,password},409);
    for(const invalid of ['usuario@','usuario@dominio','@dominio.com','usuario@@dominio.com']) {
      for(const endpoint of ['login','register']) await call('/auth/'+endpoint,{name:'Teste',email:invalid,password},400);
    }
    await call('/auth/register',{name:'Teste',email:'short.password@example.com',password:'123'},400);
    await call('/auth/register',{name:'Teste',email:'unicode.password@example.com',password:'é'.repeat(37)},400);
    const demo=await call('/auth/demo',{},200);
    await call('/auth/me',undefined,200,{token:demo.token});
    assert.equal((await call('/auth/demo',{},200)).user.id,demo.user.id);
    await call('/auth/demo',{},403,{origin:'https://untrusted.example.test'});
    console.log('AUTH PASSED',JSON.stringify({existingId:session.user.id,newEmail,newId:created.user.id,demoId:demo.user.id,checks:evidence.length}));
  }
} finally {
  await fs.mkdir('storage/validation/auth-2026-09-22',{recursive:true});
  await fs.writeFile(`storage/validation/auth-2026-09-22/api-${before?'before':'after'}.json`,JSON.stringify(evidence,null,2));
}
