import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskStore} from './store';
import {AgentRuntime} from './runtime';
import {createApp} from './app';
import {readAccessConfig,readListenConfig,type AccessConfig} from './access';
import {FileStore} from './files';

const password='only-a-test-office-password-2026',origin='http://localhost:5173';
async function serve(config:Partial<AccessConfig>={}){
 const dir=mkdtempSync(join(tmpdir(),'xuejie-access-')),store=new TaskStore(':memory:'),runtime=new AgentRuntime(store,null,{files:new FileStore(dir)});
 const task=store.create('Private policy test record');store.update(task.id,{status:'completed',result:'Private result'});
 const app=createApp(runtime,{password,origin,database:':memory:',secure:false,...config});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}`;
 const post=(path:string,body:unknown,cookie?:string)=>fetch(url+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 async function login(){const response=await post('/api/auth/login',{password});assert.equal(response.status,200);const setCookie=response.headers.get('set-cookie');assert.ok(setCookie);return {cookie:setCookie.split(';')[0],setCookie};}
 async function close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));app.locals.closeAccess();store.close();rmSync(dir,{recursive:true,force:true});}
 return {url,post,login,close,store,task};
}
test('production requires a strong password and HTTPS origin; host and PORT support cloud services',()=>{
 assert.throws(()=>readAccessConfig({NODE_ENV:'production'}),/APP_PASSWORD/);
 assert.throws(()=>readAccessConfig({NODE_ENV:'production',APP_PASSWORD:password,APP_ORIGIN:'http://localhost:3001'}),/HTTPS/);
 for(const value of ['https://user:password@example.com','https://office.example/path','https://office.example/?x=y'])assert.throws(()=>readAccessConfig({NODE_ENV:'production',APP_PASSWORD:password,APP_ORIGIN:value}));
 const config=readAccessConfig({NODE_ENV:'production',APP_PASSWORD:password,RENDER_EXTERNAL_URL:'https://office.onrender.com'});assert.equal(config?.origin,'https://office.onrender.com');assert.equal(config?.secure,true);
 assert.deepEqual(readListenConfig({NODE_ENV:'production',PORT:'10000',API_PORT:'3001'}),{port:10000,host:'0.0.0.0'});
 assert.throws(()=>readListenConfig({PORT:'not-a-port'}));assert.throws(()=>readListenConfig({PORT:'0'}));assert.equal(readAccessConfig({NODE_ENV:'development'}),null);
});
test('unauthenticated requests cannot see history, health details, SSE, upload or submit tasks',async()=>{
 const s=await serve();try{
  assert.equal((await fetch(s.url+'/healthz')).status,200);
  const session=await(await fetch(s.url+'/api/auth/session')).json();assert.deepEqual(session,{enabled:true,authenticated:false});
  for(const path of ['/api/tasks','/api/tasks/'+s.task.id,'/api/events','/api/health']){const response=await fetch(s.url+path);assert.equal(response.status,401);assert.ok(!(await response.text()).includes('Private'));}
  assert.equal((await s.post('/api/tasks',{input:'Do not execute'})).status,401);
  const upload=await fetch(s.url+'/api/files',{method:'POST',headers:{Origin:origin,'Content-Type':'application/octet-stream','X-File-Name':'policy.txt'},body:'Do not store'});assert.equal(upload.status,401);assert.equal(s.store.list().length,1);
 }finally{await s.close();}
});
test('login uses HttpOnly SameSite cookie; valid owner gets history and uploads; logout revokes it',async()=>{
 const s=await serve();try{
  assert.equal((await s.post('/api/auth/login',{password:'wrong'})).status,401);
  const {cookie,setCookie}=await s.login();assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/SameSite=Strict/i);assert.match(setCookie,/Path=\//);assert.ok(!setCookie.includes(password));
  const tasks=await(await fetch(s.url+'/api/tasks',{headers:{Cookie:cookie}})).json();assert.equal(tasks[0].result,'Private result');
  const upload=await fetch(s.url+'/api/files',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/octet-stream','X-File-Name':'policy.txt'},body:'월 33,000원'});assert.equal(upload.status,201);
  assert.equal((await s.post('/api/tasks',{input:'Translate'},cookie)).status,503); // No model configured; no fake execution.
  assert.equal((await s.post('/api/auth/logout',{},cookie)).status,200);assert.equal((await fetch(s.url+'/api/tasks',{headers:{Cookie:cookie}})).status,401);
 }finally{await s.close();}
});
test('cross-origin and missing-Origin writes fail; forged cookies fail; repeated wrong logins are limited',async()=>{
 const s=await serve();try{
  for(const source of [undefined,'https://untrusted.example']){const response=await fetch(s.url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',...(source?{Origin:source}:{})},body:JSON.stringify({password})});assert.equal(response.status,403);}
  assert.equal((await fetch(s.url+'/api/tasks',{headers:{Cookie:'xuejie_session='+'a'.repeat(64)}})).status,401);
  for(let i=0;i<5;i++)assert.equal((await s.post('/api/auth/login',{password:'wrong'})).status,401);
  const limited=await s.post('/api/auth/login',{password});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');
 }finally{await s.close();}
});
test('logout immediately closes an already authenticated SSE stream',async()=>{
 const s=await serve();try{
  const {cookie}=await s.login();const controller=new AbortController();
  try{const response=await fetch(s.url+'/api/events',{headers:{Cookie:cookie},signal:controller.signal});assert.equal(response.status,200);const reader=response.body!.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/Private policy test record/);
   await s.post('/api/auth/logout',{},cookie);assert.equal((await reader.read()).done,true);
  }finally{controller.abort();}
 }finally{await s.close();}
});
test('sessions expire and the production cookie is Secure with __Host prefix',async()=>{
 let now=Date.now();const s=await serve({secure:true,now:()=>now,sessionMs:1000});try{
  const {cookie,setCookie}=await s.login();assert.match(setCookie,/^__Host-xuejie_session=/);assert.match(setCookie,/Secure/i);
  assert.equal((await fetch(s.url+'/api/tasks',{headers:{Cookie:cookie}})).status,200);now+=1001;assert.equal((await fetch(s.url+'/api/tasks',{headers:{Cookie:cookie}})).status,401);
 }finally{await s.close();}
});
test('sessions survive restart on persistent disk and password rotation invalidates old sessions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'xuejie-access-persist-')),database=join(dir,'access.sqlite');let s=await serve({database});
 try{const {cookie}=await s.login();await s.close();s=await serve({database});assert.equal((await fetch(s.url+'/api/tasks',{headers:{Cookie:cookie}})).status,200);await s.close();s=await serve({database,password:'a-different-test-office-password'});assert.equal((await fetch(s.url+'/api/tasks',{headers:{Cookie:cookie}})).status,401);
 }finally{await s.close();rmSync(dir,{recursive:true,force:true});}
});
