import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {MockAgent} from 'undici';
import {PNG} from 'pngjs';
import {FileStore,parseSheets,aggregateRange,selectRange} from './files';
import {ToolRegistry,completeWithTools} from './tools';
import {publicAddress,publicUrl,WebReader} from './web';
import {OpenAIResponsesProvider,ProviderError,responsesSchema} from './provider';
import {TaskStore} from './store';
import {AgentRuntime} from './runtime';
import {createApp} from './app';
import {workbook} from '../tests/file-fixture';
import {documentInput} from './documents';
import type {AgentContext,LLMProvider,ToolCallRecord} from './types';
const finalSchema={type:'object',properties:{status:{type:'string',enum:['completed','needs_input']},output:{type:'string'},question:{type:'string'}},required:['status','output','question'],additionalProperties:false};
const result=(output:string)=>JSON.stringify({status:'completed',output,question:''});
const plan=(agentId='translator',depends=false)=>JSON.stringify({action:'execute',steps:[{id:'read',agentId,instruction:agentId==='data'?'计算月利润':'翻译附件',dependsOn:[]},...(depends?[{id:'copy',agentId:'design',instruction:'写文案',dependsOn:['read']}]:[])],question:'',scopeNote:''});
const toolCall=(name:string,input:unknown)=>JSON.stringify({toolCall:{name,input}});
const setup=()=>{const dir=mkdtempSync(join(tmpdir(),'xuejie-tools-'));return {dir,files:new FileStore(dir),cleanup:()=>rmSync(dir,{recursive:true,force:true})};};
async function settle(runtime:AgentRuntime){for(let i=0;i<500;i++){await new Promise<void>(r=>setImmediate(r));if(!runtime.queue.busy)return;}throw new Error('Runtime did not finish');}
test('Responses schema adapter retains required fields and recursion while adapting unsupported keywords',()=>{
 const original={$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',required:['expression','url'],properties:{url:{type:'string',format:'uri'},expression:{$ref:'#/$defs/expression'}},$defs:{expression:{oneOf:[{type:'object',properties:{type:{const:'literal'},value:{type:'number'}},required:['type','value'],additionalProperties:false},{type:'object',properties:{type:{const:'recursive'},child:{$ref:'#/$defs/expression'}},required:['type','child'],additionalProperties:false}]}}};
 const adapted=responsesSchema(original);assert.deepEqual(adapted.required,['expression','url']);assert.ok(!JSON.stringify(adapted).includes('oneOf'));assert.ok(!JSON.stringify(adapted).includes('"format":"uri"'));assert.match(JSON.stringify(adapted),/#\/\$defs\/expression/);assert.ok(JSON.stringify(original).includes('oneOf'));
});

test('uploads preserve bytes and metadata after reopen; rejects unsupported files and traversal',async()=>{
 const {dir,files,cleanup}=setup();try{
  const file=await files.upload('政策.txt',Buffer.from('월 33,000원.'));
  assert.equal(new FileStore(dir).get(file.id).sha256,file.sha256);assert.equal(files.readText(file,0,8000).text,'월 33,000원.');
  for(const name of ['../key.txt','x.pdf','x.xls','bad\\x.txt'])await assert.rejects(()=>files.upload(name,Buffer.from('x')),ProviderError);
  await assert.rejects(()=>files.upload('x.txt',Buffer.from([255,0])),ProviderError);
  writeFileSync(join(dir,file.id+'.bin'),'changed');assert.throws(()=>files.bytes(file),ProviderError);
 }finally{cleanup();}
});
test('policy images and PDFs retain actual bytes; reject wrong formats, encryption and huge images',async()=>{
 const {dir,files,cleanup}=setup();try{
  const image=PNG.sync.write(new PNG({width:2,height:2}));
  const file=await files.upload('政策.png',image);
  assert.equal(new FileStore(dir).get(file.id).format,'png');assert.deepEqual(Buffer.from(files.document(file).bytes),image);
  const pdf=Buffer.from('%PDF-1.7\n1 0 obj<</Type /Catalog>>endobj\n%%EOF');
  const attached=await files.upload('政策.pdf',pdf);assert.equal(files.document(attached).mimeType,'application/pdf');
  for(const [name,bytes] of [['伪装.png',pdf],['伪装.jpg',image],['动态.png',Buffer.concat([image,Buffer.from('acTL')])],['加密.pdf',Buffer.from('%PDF-1.7\n/Encrypt 1 0 R\n%%EOF')]] as const)await assert.rejects(()=>files.upload(name,bytes),ProviderError);
  const huge=Buffer.from(image);huge.writeUInt32BE(8193,16);assert.throws(()=>documentInput('超大.png','png',huge),/尺寸/);
  writeFileSync(join(dir,file.id+'.bin'),'tampered');assert.throws(()=>files.document(file),/完整性/);
 }finally{cleanup();}
});
test('document tool reads only attached bytes and preserves partial recognition and uncertain prices',async()=>{
 const {files,cleanup}=setup();let reads=0;try{
  const image=PNG.sync.write(new PNG({width:2,height:2})),file=await files.upload('政策.png',image);
  const provider:LLMProvider={async complete(){throw new Error('not called');},async readDocument(document){reads++;assert.deepEqual(Buffer.from(document.bytes),image);return {text:'월 [无法辨认]원',coverage:'partial',uncertain:['月费金额模糊'],notes:'仅上半部分可辨认'};}};
  const reader=new ToolRegistry(files,provider).tools.find(t=>t.name==='document.read')!;
  await assert.rejects(()=>reader.execute({fileId:file.id},{attachments:[]}),/已附加/);assert.equal(reads,0);
  const output=await reader.execute({fileId:file.id},{attachments:[file]}) as {text:string;coverage:string;uncertain:string[];sha256:string};
  assert.equal(output.coverage,'partial');assert.equal(output.text,'월 [无法辨认]원');assert.deepEqual(output.uncertain,['月费金额模糊']);assert.equal(output.sha256,file.sha256);assert.equal(reads,1);
  assert.ok(!new ToolRegistry(files,{async complete(){return '';}}).tools.some(t=>t.name==='document.read'));
  const unreadable=new ToolRegistry(files,{async complete(){return '';},async readDocument(){return {text:'',coverage:'unreadable',uncertain:[],notes:'不可读'};}}).tools.find(t=>t.name==='document.read')!;
  await assert.rejects(()=>unreadable.execute({fileId:file.id},{attachments:[file]}),/无法辨认/);
 }finally{cleanup();}
});
test('Responses sends actual image/PDF content securely and rejects unreadable recognition',async()=>{
 const mock=new MockAgent();mock.disableNetConnect();const pool=mock.get('https://api.openai.com');
 const image=PNG.sync.write(new PNG({width:2,height:2})),pdf=Buffer.from('%PDF-1.7\n%%EOF');
 for(const document of [documentInput('政策.png','png',image),documentInput('政策.pdf','pdf',pdf)]){
  pool.intercept({path:'/v1/responses',method:'POST'}).reply(options=>{
   assert.equal(new Headers(options.headers).get('authorization'),'Bearer test-placeholder');const body=JSON.parse(String(options.body));
   assert.equal(body.store,false);assert.equal(body.model,'gpt-6-luna');assert.equal(body.text.format.type,'json_schema');
   const content=body.input[1].content;assert.equal(content[0].type,'input_text');
   const part=content[1];if(document.mimeType==='application/pdf'){assert.equal(part.type,'input_file');assert.equal(part.filename,'政策.pdf');assert.equal(part.file_data,`data:application/pdf;base64,${pdf.toString('base64')}`);}else{assert.equal(part.type,'input_image');assert.equal(part.detail,'high');assert.equal(part.image_url,`data:image/png;base64,${image.toString('base64')}`);}
   return {statusCode:200,data:JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text:'월 33,000원',coverage:'complete',uncertain:[],notes:'一页'})}]}]})};
  });
 }
 pool.intercept({path:'/v1/responses',method:'POST'}).reply(200,{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({text:'',coverage:'unreadable',uncertain:[],notes:'无法辨认'})}]}]});
 try{
  const provider=new OpenAIResponsesProvider({baseUrl:'https://api.openai.com/v1',model:'gpt-6-luna',apiKey:'test-placeholder',maxTokens:4096,timeoutMs:2000},mock);
  assert.match((await provider.readDocument(documentInput('政策.png','png',image))).text,/33,000/);
  assert.match((await provider.readDocument(documentInput('政策.pdf','pdf',pdf))).text,/33,000/);
  await assert.rejects(()=>provider.readDocument(documentInput('政策.png','png',image)),/无法辨认/);mock.assertNoPendingInterceptors();
 }finally{await mock.close();}
});
test('runtime records actual document read before translation and blocks unread images',async()=>{
 const {files,cleanup}=setup();try{
  const file=await files.upload('政策.png',PNG.sync.write(new PNG({width:2,height:2})));
  for(const shouldRead of [true,false]){
   const store=new TaskStore(':memory:');let reads=0;
   const responses=[plan(),...(shouldRead?[toolCall('document.read',{fileId:file.id})]:[]),result('每月33,000韩元。'),'汇总：每月33,000韩元。'];
   const provider:LLMProvider={async complete(request){const answer=responses.shift()!;if(shouldRead&&answer.includes('每月')&&request.jsonSchema)assert.equal(JSON.parse(request.user).toolsResults[0].output.text,'월 33,000원');return answer;},async readDocument(){reads++;return {text:'월 33,000원',coverage:'complete',uncertain:[],notes:'仅所附截图'};}};
   const runtime=new AgentRuntime(store,provider,{files}),task=runtime.submit('翻译政策',undefined,[file.id]);await settle(runtime);
   assert.equal(store.get(task.id)?.status,shouldRead?'completed':'failed');assert.equal(reads,shouldRead?1:0);
   if(shouldRead){assert.equal(store.get(task.id)?.steps?.[0].toolCalls?.[0].name,'document.read');assert.equal(store.get(task.id)?.steps?.[0].toolCalls?.[0].status,'completed');}else assert.equal(store.get(task.id)?.result,undefined);
   store.close();
  }
 }finally{cleanup();}
});
test('CSV range aggregation uses exact decimal arithmetic, blanks and rejects text/header values',async()=>{
 const sheets=await parseSheets(Buffer.from('\ufeff收入,成本\n0.1,0.05\n0.2,0.10\n,0.02\n'),'csv');
 assert.equal(aggregateRange(selectRange(sheets,{sheet:'CSV',startRow:2,endRow:4,startColumn:1,endColumn:1}),'sum').value,'0.3');
 assert.equal(aggregateRange([['0.1'],['0.2']],'average').value,'0.15');
 assert.equal(aggregateRange([['10%'],['20%']],'sum').value,'0.3');
 assert.deepEqual(aggregateRange([['1'],[null]],'count'),{value:'1',nonEmptyCells:1,blankCells:1});
 assert.throws(()=>aggregateRange([['表头'],['1']],'sum'),ProviderError);
 assert.throws(()=>selectRange(sheets,{sheet:'CSV',startRow:2,endRow:99,startColumn:1,endColumn:1}),ProviderError);
});
test('literal XLSX is read with original decimal strings; formulas and out-of-bounds sparse cells are rejected',async()=>{
 const sheets=await parseSheets(workbook(),'xlsx');assert.equal(sheets[0].name,'月度数据');assert.equal(sheets[0].rows[1][1],'33000');
 assert.equal(aggregateRange(selectRange(sheets,{sheet:'月度数据',startRow:2,endRow:3,startColumn:2,endColumn:2}),'sum').value,'77000');
 await assert.rejects(()=>parseSheets(workbook(true),'xlsx'),/含公式/);
 await assert.rejects(()=>parseSheets(workbook(false,'XFD1048576'),'xlsx'),ProviderError);
});
test('tools enforce attached-file scope, input validation and per-task web permission',async()=>{
 const {files,cleanup}=setup();try{
  const file=await files.upload('政策.md',Buffer.from('原始政策'));
  const tools=new ToolRegistry(files);const reader=tools.tools.find(t=>t.name==='file.read')!;
  await assert.rejects(()=>reader.execute({fileId:file.id,offset:0,length:100},{attachments:[]}),/已附加/);
  await assert.rejects(()=>reader.execute({fileId:file.id,offset:0,length:100,path:'/etc/passwd'},{attachments:[file]}),/输入无效/);
  await assert.rejects(()=>tools.tools.find(t=>t.name==='web.read')!.execute({url:'https://example.com'},{attachments:[]}),/未启用/);
  assert.equal((await reader.execute({fileId:file.id,offset:0,length:100},{attachments:[file]}) as {text:string}).text,'原始政策');
 }finally{cleanup();}
});
test('structured tool loop executes actual file read, passes real output to LLM and records progress',async()=>{
 const {files,cleanup}=setup();try{
  const file=await files.upload('政策.txt',Buffer.from('월 33,000원.'));const records:ToolCallRecord[]=[];let calls=0;
  const provider:LLMProvider={async complete(request){calls++;assert.ok(request.jsonSchema);const schema=request.jsonSchema.schema;assert.ok((schema.required as string[]).includes('toolCall'));const data=JSON.parse(request.user);if(calls===1)return JSON.stringify({status:'tool_call',output:'',question:'',toolCall:{name:'file.read',input:{fileId:file.id,offset:0,length:8000}}});assert.equal(data.toolsResults[0].output.text,'월 33,000원.');return JSON.stringify({status:'completed',output:'每月33,000韩元。',question:'',toolCall:null});}};
  const answer=await completeWithTools(provider,'翻译',{input:'翻译',instruction:'翻译',dependencies:{},attachments:[file],onToolCall:r=>records.push(r)},new ToolRegistry(files).forAgent('translator'),finalSchema);
  assert.equal(JSON.parse(answer.raw).output,'每月33,000韩元。');assert.match(answer.sources.tool_1,/33,000/);assert.deepEqual(records.map(r=>r.status),['running','completed']);
 }finally{cleanup();}
});
test('tool loop is bounded and refuses fabricated or unavailable tools',async()=>{
 const {files,cleanup}=setup();try{
  const file=await files.upload('a.txt',Buffer.from('data'));const context:AgentContext={input:'x',instruction:'x',dependencies:{},attachments:[file]};const tools=new ToolRegistry(files).forAgent('translator');let calls=0;
  await assert.rejects(()=>completeWithTools({async complete(){calls++;return toolCall('file.read',{fileId:file.id,offset:0,length:10});}},'test',context,tools,finalSchema),/六次上限/);assert.equal(calls,7);
  await assert.rejects(()=>completeWithTools({async complete(){return toolCall('shell.exec',{cmd:'echo x'});}},'test',context,tools,finalSchema),/不可用/);
 }finally{cleanup();}
});
test('runtime persists real file calls and inherited attachments across clarification follow-up',async()=>{
 const {files,cleanup}=setup();const store=new TaskStore(':memory:');try{
  const file=await files.upload('a.txt',Buffer.from('原文'));let calls=0;
  const responses=[JSON.stringify({action:'clarify',steps:[],question:'目标语言？',scopeNote:''}),plan(),toolCall('file.read',{fileId:file.id,offset:0,length:8000}),result('真实文件结果'),'汇总'];
  const runtime=new AgentRuntime(store,{async complete(){calls++;return responses.shift()!;}},{files});
  const first=runtime.submit('翻译附件',undefined,[file.id]);await settle(runtime);const next=runtime.submit('译成中文',first.id);await settle(runtime);
  assert.equal(store.get(next.id)?.status,'completed');assert.equal(store.get(next.id)?.attachments?.[0].id,file.id);assert.equal(store.get(next.id)?.steps?.[0].toolCalls?.[0].status,'completed');assert.equal(calls,5);
 }finally{store.close();cleanup();}
});
test('Data uses server aggregate sources for profit, not invented file numbers',async()=>{
 const {files,cleanup}=setup();const store=new TaskStore(':memory:');try{
  const file=await files.upload('门店.csv',Buffer.from('收入,成本\n33000,22000\n44000,30000\n'));
  const range={fileId:file.id,sheet:'CSV',startRow:2,endRow:3,operation:'sum'};let calls=0;
  const provider:LLMProvider={async complete(request){calls++;if(calls===1)return plan('data');if(calls===2)return toolCall('spreadsheet.aggregate',{...range,startColumn:1,endColumn:1});if(calls===3)return toolCall('spreadsheet.aggregate',{...range,startColumn:2,endColumn:2});if(calls===4){const data=JSON.parse(request.user);assert.equal(data.toolsResults[0].output.value,'77000');return JSON.stringify({status:'completed',output:'按附件月度同币种口径。',question:'',calculations:[{label:'利润',unit:'韩元',expression:{type:'operation',op:'subtract',left:{type:'source',sourceId:'tool_1',quote:'"value":"77000"',value:'77000'},right:{type:'source',sourceId:'tool_2',quote:'"value":"52000"',value:'52000'}}}]});}return '利润25000韩元';}};
  const runtime=new AgentRuntime(store,provider,{files}),task=runtime.submit('计算月利润，收入和成本均为含税韩元。',undefined,[file.id]);await settle(runtime);
  assert.equal(store.get(task.id)?.status,'completed');assert.equal(store.get(task.id)?.steps?.[0].calculations?.[0].value,'25000');assert.equal(store.get(task.id)?.steps?.[0].toolCalls?.length,2);
 }finally{store.close();cleanup();}
});
test('failed file tool blocks downstream; model cannot pretend unread attachments succeeded',async()=>{
 const {files,cleanup}=setup();try{
  const file=await files.upload('a.txt',Buffer.from('source'));
  for(const response of [toolCall('file.read',{fileId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',offset:0,length:10}),result('声称已读')]) {
   const store=new TaskStore(':memory:');const responses=[plan('translator',true),response,result('文案'),'汇总'];const runtime=new AgentRuntime(store,{async complete(){return responses.shift()!;}},{files});const task=runtime.submit('处理附件',undefined,[file.id]);await settle(runtime);assert.equal(store.get(task.id)?.status,'failed');assert.equal(store.get(task.id)?.result,undefined);if(response.includes('toolCall')){assert.equal(store.get(task.id)?.steps?.[0].toolCalls?.[0].status,'failed');assert.equal(store.get(task.id)?.steps?.[1].status,'blocked');}store.close();
  }
 }finally{cleanup();}
});
test('web reader validates DNS and redirects, strips executable HTML and retains factual source',async()=>{
 assert.equal(publicAddress('127.0.0.1'),false);assert.equal(publicAddress('10.0.0.1'),false);assert.equal(publicAddress('100.64.0.1'),false);assert.equal(publicAddress('8.8.8.8'),true);
 for(const url of ['http://example.com','https://127.0.0.1','https://x:y@example.com','https://example.com:444','https://service.internal'])await assert.rejects(()=>publicUrl(url,async()=>[{address:'8.8.8.8'}]),ProviderError);
 await assert.rejects(()=>publicUrl('https://example.com',async()=>[{address:'192.168.1.1'}]),ProviderError);
 const mock=new MockAgent();mock.disableNetConnect();const pool=mock.get('https://example.com');pool.intercept({path:'/policy',method:'GET'}).reply(200,'<title>真实标题</title><main><p>月费33,000</p><script>steal()</script></main>',{headers:{'content-type':'text/html'}});pool.intercept({path:'/redirect',method:'GET'}).reply(302,'',{headers:{location:'https://127.0.0.1/secret'}});
 try{const reader=new WebReader(mock,async()=>[{address:'8.8.8.8'}]);const answer=await reader.read('https://example.com/policy');assert.equal(answer.title,'真实标题');assert.match(answer.text,/33,000/);assert.ok(!answer.text.includes('steal'));await assert.rejects(()=>reader.read('https://example.com/redirect'),ProviderError);mock.assertNoPendingInterceptors();}finally{await mock.close();}
});
test('Responses web search requires actual search block and preserves clickable citations',async()=>{
 const mock=new MockAgent();mock.disableNetConnect();mock.get('https://api.openai.com').intercept({path:'/v1/responses',method:'POST'}).reply(options=>{const sent=JSON.parse(String(options.body));assert.deepEqual(sent.tools,[{type:'web_search',search_context_size:'low'}]);assert.equal(sent.tool_choice,'required');assert.equal(sent.max_tool_calls,1);return {statusCode:200,data:JSON.stringify({status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'有来源的搜索结果',annotations:[{type:'url_citation',url:'https://example.com/policy',title:'政策来源'}]}]}]})};});
 try{const provider=new OpenAIResponsesProvider({baseUrl:'https://api.openai.com/v1',model:'gpt-6-luna',apiKey:'test-placeholder',maxTokens:4096,timeoutMs:2000},mock);const answer=await provider.searchWeb('查询');assert.equal(answer.citations[0].url,'https://example.com/policy');assert.match(answer.text,/搜索结果/);mock.assertNoPendingInterceptors();}finally{await mock.close();}
});
test('binary upload API applies same-origin checks and rejects missing task files before LLM runs',async()=>{
 const {files,cleanup}=setup();const store=new TaskStore(':memory:');let calls=0;const server=createApp(new AgentRuntime(store,{async complete(){calls++;return plan();}},{files})).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}`;
 try{const headers={'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent('政策.txt')};assert.equal((await fetch(url+'/api/files',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:'内容'})).status,403);const response=await fetch(url+'/api/files',{method:'POST',headers,body:'内容'});assert.equal(response.status,201);const file=await response.json();assert.equal(file.name,'政策.txt');assert.equal((await fetch(url+'/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:'读文件',fileIds:['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']})})).status,400);assert.equal(calls,0);}
 finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();cleanup();}
});
test('restart marks genuine in-flight tool call failed while preserving prior completed tools',()=>{
 const store=new TaskStore(':memory:'),task=store.create('中断');store.update(task.id,{status:'running',steps:[{id:'read',agentId:'policy',instruction:'查询',dependsOn:[],status:'running',toolCalls:[{id:'tool_1',name:'web.read',input:{},status:'completed',startedAt:'2026-01-01',output:{text:'已读取'}},{id:'tool_2',name:'web.search',input:{},status:'running',startedAt:'2026-01-01'}]}]});new AgentRuntime(store,null);assert.deepEqual(store.get(task.id)?.steps?.[0].toolCalls?.map(c=>c.status),['completed','failed']);assert.equal(store.get(task.id)?.status,'failed');store.close();
});
test('second backend startup fails visibly without mutating live task state',async()=>{
 const {dir,cleanup}=setup(),db=join(dir,'tasks.sqlite'),store=new TaskStore(db),task=store.create('进行中的真实任务');store.update(task.id,{status:'running'});
 const server=createServer().listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');
 try{
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,LLM_API_KEY:'',API_PORT:String(address.port),TASK_DB_PATH:db,UPLOAD_DIR:join(dir,'uploads')},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});const exit=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.equal(exit,1);assert.match(output,/failed to bind/);assert.ok(!output.includes('Agent Runtime listening'));assert.equal(store.get(task.id)?.status,'running');
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();cleanup();}
});
