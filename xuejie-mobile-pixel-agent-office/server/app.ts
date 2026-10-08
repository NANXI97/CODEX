import express from 'express';
import {z}from'zod';
import {resolve}from'node:path';
import {AgentRuntime}from'./runtime';
import {ProviderError}from'./provider';
import {MAX_FILE_BYTES}from'./files';
export function createApp(runtime:AgentRuntime){const app=express();app.disable('x-powered-by');app.use(express.json({limit:'64kb'}));
 app.use('/api',(req,res,next)=>{res.setHeader('Cache-Control','no-store');if(req.method==='POST'){const origin=req.headers.origin;const allowed=[process.env.APP_ORIGIN??'http://localhost:5173','http://127.0.0.1:5173',`http://localhost:${process.env.API_PORT??3001}`,`http://127.0.0.1:${process.env.API_PORT??3001}`];if(origin&&!allowed.includes(origin)){res.status(403).json({error:'请求来源不允许。'});return;}const type=req.path==='/files'?'application/octet-stream':'application/json';if(!req.is(type)){res.status(415).json({error:'请求内容格式不受支持。'});return;}}next();});
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
  const send=(event:string,data:unknown,id?:number)=>{if(res.writableLength>1024*1024){res.end();return;}res.write(`${id?`id: ${id}\n`:''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
  // Fresh authoritative snapshot on every connection, including reconnects. No timer invents statuses.
  send('snapshot',runtime.store.snapshot());const off=runtime.events.subscribe(e=>send(e.kind,e,e.sequence));
  const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clearInterval(heartbeat);off();});
 });
 app.use(express.static(resolve('dist')));
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(400).json({error:'请求无效或超过大小限制。'});});
 return app;
}
