import express from 'express';
import {z}from'zod';
import {resolve}from'node:path';
import {AgentRuntime}from'./runtime';
import {ProviderError}from'./provider';
import {MAX_FILE_BYTES}from'./files';
import {OfficeAccess,readAccessConfig,type AccessConfig} from './access';
export function createApp(runtime:AgentRuntime,config:AccessConfig|null=readAccessConfig()){const app=express();app.disable('x-powered-by');
 const access=config?new OfficeAccess(config):null;app.locals.closeAccess=()=>access?.close();
 // Render's edge terminates HTTPS and is the only proxy hop trusted for client-IP rate limits.
 if(process.env.RENDER_EXTERNAL_URL)app.set('trust proxy',1);
 app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');if(access){res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");if(config?.secure)res.setHeader('Strict-Transport-Security','max-age=31536000');}next();});
 app.get('/healthz',(_req,res)=>res.json({ok:true}));
 app.use('/api',(req,res,next)=>{res.setHeader('Cache-Control','no-store');if(req.method==='POST'){const origin=req.headers.origin;const allowed=access?[access.config.origin]:[process.env.APP_ORIGIN??'http://localhost:5173','http://127.0.0.1:5173',`http://localhost:${process.env.API_PORT??3001}`,`http://127.0.0.1:${process.env.API_PORT??3001}`];if((access&&!origin)||(origin&&!allowed.includes(origin))){res.status(403).json({error:'请求来源不允许。'});return;}const type=req.path==='/files'?'application/octet-stream':'application/json';if(!req.is(type)){res.status(415).json({error:'请求内容格式不受支持。'});return;}}next();});
 app.post('/api/auth/login',(req,res,next)=>{if(access&&!access.allowAttempt(req.ip??req.socket.remoteAddress??'unknown')){res.setHeader('Retry-After','900');res.status(429).json({error:'尝试次数过多，请 15 分钟后再试。'});return;}next();});
 app.use(express.json({limit:'64kb'}));
 app.get('/api/auth/session',(req,res)=>res.json({enabled:!!access,authenticated:!access||access.authenticated(req)}));
 app.post('/api/auth/login',async(req,res)=>{if(!access){res.json({authenticated:true});return;}if(!await access.login(req.body?.password,req.ip??req.socket.remoteAddress??'unknown',res)){res.status(401).json({error:'登录密码不正确。'});return;}res.json({authenticated:true});});
 app.post('/api/auth/logout',(req,res)=>{access?.logout(req,res);res.json({authenticated:false});});
 app.use('/api',(req,res,next)=>{if(access&&!access.authenticated(req)){res.status(401).json({error:'请先登录工作室。'});return;}next();});
 app.get('/api/health',(_req,res)=>res.json({ok:true,llmConfigured:!!runtime.provider,workflow:'multi-agent',phase:4,maxParallelSteps:runtime.maxParallelSteps,active:runtime.queue.busy,queued:runtime.queue.size,filesConfigured:!!runtime.files,webSearchConfigured:!!runtime.provider?.searchWeb,documentReadConfigured:!!runtime.provider?.readDocument}));
 app.post('/api/files',express.raw({type:'application/octet-stream',limit:MAX_FILE_BYTES}),async(req,res)=>{
  if(!runtime.files){res.status(503).json({error:'附件服务尚未配置。'});return;}
  try{const name=decodeURIComponent(req.get('X-File-Name')??'');const file=await runtime.files.upload(name,req.body);res.status(201).json(file);}catch(e){res.status(400).json({error:e instanceof ProviderError?e.message:'文件上传失败。'});}
 });
 app.get('/api/tasks',(_req,res)=>res.json(runtime.store.list()));
 app.get('/api/tasks/:id',(req,res)=>{const task=runtime.store.get(req.params.id);res.status(task?200:404).json(task??{error:'任务不存在。'});});
 app.post('/api/tasks',(req,res)=>{const data=z.object({input:z.string().trim().min(1).max(12000),parentId:z.string().uuid().optional(),fileIds:z.array(z.string().uuid()).max(4).optional(),allowWeb:z.boolean().optional()}).strict().safeParse(req.body);if(!data.success){res.status(400).json({error:'请输入 1–12000 字的任务，每次最多附加四个文件。'});return;}
  if(data.data.parentId&&!runtime.store.get(data.data.parentId)){res.status(404).json({error:'原任务不存在。'});return;}
  try{res.status(202).json(runtime.submit(data.data.input,data.data.parentId,data.data.fileIds,data.data.allowWeb));}catch(e){res.status(e instanceof ProviderError&&e.code==='NOT_CONFIGURED'?503:e instanceof ProviderError&&e.code==='QUEUE_FULL'?429:400).json({error:e instanceof ProviderError?e.message:'任务提交失败。'});}});
 app.get('/api/events',(req,res)=>{res.setHeader('Content-Type','text/event-stream');res.setHeader('Connection','keep-alive');res.setHeader('X-Accel-Buffering','no');res.flushHeaders();
  const token=access?.token(req);const allowed=()=>!access||access.valid(token);
  const send=(event:string,data:unknown,id?:number)=>{if(!allowed()||res.writableLength>1024*1024){res.end();return;}res.write(`${id?`id: ${id}\n`:''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
  // Fresh authoritative snapshot on every connection, including reconnects. No timer invents statuses.
  send('snapshot',runtime.store.snapshot());const off=runtime.events.subscribe(e=>send(e.kind,e,e.sequence));
  const revoke=access&&token?access.onRevoke(token,()=>res.end()):()=>{};
  const heartbeat=setInterval(()=>{if(!allowed()){res.end();return;}res.write(': heartbeat\n\n');},15000);req.on('close',()=>{clearInterval(heartbeat);off();revoke();});
 });
 app.use(express.static(resolve('dist')));
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(400).json({error:'请求无效或超过大小限制。'});});
 return app;
}
