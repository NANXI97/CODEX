import {test,expect}from'@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '../server/files';
import{TaskStore}from'../server/store';import{AgentRuntime}from'../server/runtime';import{createApp}from'../server/app';import type{LLMProvider}from'../server/types';
test('UI connects to real HTTP/SSE runtime with an explicitly injected TEST provider',async({page})=>{
 const store=new TaskStore(':memory:');const completions:((text:string)=>void)[]=[];
 const provider:LLMProvider={complete:()=>new Promise(resolve=>completions.push(resolve))};
 const runtime=new AgentRuntime(store,provider),server=createApp(runtime).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test port');const url=`http://127.0.0.1:${address.port}`;const previousOrigin=process.env.APP_ORIGIN;process.env.APP_ORIGIN=url;
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(url);await expect(page.getByRole('status')).toContainText('Runtime 已连接');await expect(page.locator('.dev')).toHaveCount(0);
  await page.getByLabel('团队任务').fill('翻译成中文：월 33,000원. 약정 24개월.');await page.getByRole('button',{name:'提交任务'}).click();
  await expect(page.locator('.roster article').nth(0)).toContainText('THINKING');await expect.poll(()=>completions.length).toBe(1);
  completions[0](JSON.stringify({action:'execute',steps:[{id:'translate',agentId:'translator',instruction:'翻译成简体中文',dependsOn:[]}],question:'',scopeNote:''}));
  await expect(page.locator('.roster article').nth(3)).toContainText('WORKING');await expect.poll(()=>completions.length).toBe(2);
  await expect.poll(()=>page.locator('.roster article').nth(3).innerText()).not.toContain('移动中');
  for(const i of [1,2,4,5])await expect(page.locator('.roster article').nth(i)).toContainText('IDLE');
  completions[1](JSON.stringify({status:'completed',output:'每月 33,000 韩元，合约期 24 个月。',question:''}));await expect.poll(()=>completions.length).toBe(3);await expect(page.locator('.roster article').nth(0)).toContainText('WORKING');
  completions[2]('每月 33,000 韩元，合约期 24 个月。');await expect(page.locator('.task-result')).toContainText('已完成');await expect(page.locator('.task-result pre').first()).toHaveText('每月 33,000 韩元，合约期 24 个月。');
  await page.reload();await expect(page.locator('.task-result')).toContainText('已完成');await expect(page.getByRole('status')).toContainText('Runtime 已连接');expect(errors).toEqual([]);
 }finally{await page.goto('about:blank');server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();if(previousOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previousOrigin;}
});
test('unconfigured production runtime does not pretend to execute tasks',async({page})=>{
 const store=new TaskStore(':memory:'),server=createApp(new AgentRuntime(store,null)).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test port');
 try{await page.goto(`http://127.0.0.1:${address.port}`);await expect(page.getByRole('status')).toContainText('模型尚未配置');await expect(page.getByRole('button',{name:'提交任务'})).toBeDisabled();await expect(page.locator('.roster .IDLE')).toHaveCount(6);}
 finally{await page.goto('about:blank');server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();}
});

test('dependent steps, verified profit and results update over HTTP/SSE and survive reload',async({page})=>{
 const store=new TaskStore(':memory:'),completions:((text:string)=>void)[]=[];
 const runtime=new AgentRuntime(store,{complete:()=>new Promise(resolve=>completions.push(resolve))}),server=createApp(runtime).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test port');const url=`http://127.0.0.1:${address.port}`,previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN=url;
 const text=(output:string)=>JSON.stringify({status:'completed',output,question:''});
 try{
  await page.goto(url);await expect(page.getByRole('status')).toContainText('Runtime 已连接');await page.getByLabel('团队任务').fill('翻译政策、整理、算利润、写朋友圈。收入33,000韩元，成本22,000韩元。');await page.getByRole('button',{name:'提交任务'}).click();await expect.poll(()=>completions.length).toBe(1);
  completions[0](JSON.stringify({action:'execute',question:'',scopeNote:'',steps:[{id:'translate',agentId:'translator',instruction:'翻译政策',dependsOn:[]},{id:'policy',agentId:'policy',instruction:'整理政策',dependsOn:['translate']},{id:'data',agentId:'data',instruction:'计算月利润',dependsOn:['policy']},{id:'copy',agentId:'design',instruction:'写朋友圈',dependsOn:['data']}]}));
  const workflow=page.getByRole('region',{name:'团队执行步骤'});await expect(workflow.locator('li')).toHaveCount(4);await expect(workflow.locator('[data-step-id=policy]')).toHaveAttribute('data-step-status','waiting');await expect(page.locator('.roster article').nth(3)).toContainText('WORKING');await expect(page.locator('.roster article').nth(4)).toContainText('WAITING');
  await expect.poll(()=>completions.length).toBe(2);completions[1](text('月费33,000韩元，仅新客户。'));await expect.poll(()=>completions.length).toBe(3);await expect(workflow.locator('[data-step-id=policy]')).toHaveAttribute('data-step-status','running');completions[2](text('月费33,000韩元，仅新客户。'));
  await expect.poll(()=>completions.length).toBe(4);completions[3](JSON.stringify({status:'completed',output:'月度同币种口径',question:'',calculations:[{label:'月利润',unit:'韩元',expression:{type:'operation',op:'subtract',left:{type:'source',sourceId:'user',quote:'收入33,000韩元',value:'33,000'},right:{type:'source',sourceId:'user',quote:'成本22,000韩元',value:'22,000'}}}]}));
  await expect.poll(()=>completions.length).toBe(5);await expect(workflow.locator('[data-step-id=data]')).toHaveAttribute('data-step-status','completed');completions[4](text('学生套餐，仅新客户，欢迎咨询。'));await expect.poll(()=>completions.length).toBe(6);completions[5]('译文、政策、月利润11000韩元及文案已汇总。');
  await expect(workflow).toContainText('4/4 步完成');await workflow.locator('[data-step-id=data] summary').click();await expect(workflow.locator('[data-step-id=data] pre')).toContainText('11000韩元');await expect(page.locator('.roster .IDLE')).toHaveCount(6);
  await page.reload();await expect(page.getByRole('region',{name:'团队执行步骤'})).toContainText('4/4 步完成');await expect(page.locator('.task-result pre').first()).toContainText('月利润11000韩元');
 }finally{await page.goto('about:blank');server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});

test('after reload, supplemental input is linked to the original clarification task',async({page})=>{
 const store=new TaskStore(':memory:'),completions:((text:string)=>void)[]=[];
 const runtime=new AgentRuntime(store,{complete:()=>new Promise(resolve=>completions.push(resolve))}),server=createApp(runtime).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test port');const url=`http://127.0.0.1:${address.port}`,previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN=url;
 try{
  await page.goto(url);await expect(page.getByRole('status')).toContainText('Runtime 已连接');await page.getByLabel('团队任务').fill('收入33,000韩元，计算月利润。');await page.getByRole('button',{name:'提交任务'}).click();await expect.poll(()=>completions.length).toBe(1);completions[0](JSON.stringify({action:'clarify',steps:[],question:'请补充月成本。',scopeNote:''}));await expect(page.locator('.task-result')).toContainText('请补充月成本');const original=store.list()[0].id;
  await page.reload();await expect(page.getByRole('status')).toContainText('Runtime 已连接');await page.getByLabel('团队任务').fill('成本22,000韩元。');await page.getByRole('button',{name:'补充并继续'}).click();await expect.poll(()=>completions.length).toBe(2);expect(store.list()[0].parentId).toBe(original);completions[1](JSON.stringify({action:'unsupported',steps:[],question:'测试已验证补充关联，不执行额外模型调用。',scopeNote:''}));await expect(page.locator('.task-result')).toContainText('执行失败');
 }finally{await page.goto('about:blank');server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});

test('upload CSV, real server aggregate, tool provenance and task attachment survive reload',async({page})=>{
 const directory=mkdtempSync(join(tmpdir(),'xuejie-browser-files-')),files=new FileStore(directory),store=new TaskStore(':memory:');let calls=0;
 const runtime=new AgentRuntime(store,{async complete(request){calls++;if(calls===1)return JSON.stringify({action:'execute',question:'',scopeNote:'',steps:[{id:'data',agentId:'data',instruction:'计算收入合计',dependsOn:[]}]});const context=JSON.parse(request.user);if(calls===2)return JSON.stringify({toolCall:{name:'spreadsheet.aggregate',input:{fileId:context.attachments[0].id,sheet:'CSV',startRow:2,endRow:3,startColumn:1,endColumn:1,operation:'sum'}}});if(calls===3){expect(context.toolsResults[0].output.value).toBe('0.3');return JSON.stringify({status:'completed',output:'实际附件两行收入合计',question:'',calculations:[{label:'收入合计',unit:'元',expression:{type:'source',sourceId:'tool_1',quote:'"value":"0.3"',value:'0.3'}}]});}return '两行收入合计0.3元';}},{files}),server=createApp(runtime).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw new Error('Missing port');const url=`http://127.0.0.1:${address.port}`,previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN=url;
 try{
  await page.goto(url);await expect(page.getByRole('status')).toContainText('Runtime 已连接');await page.getByLabel('添加资料').setInputFiles({name:'数据.csv',mimeType:'text/csv',buffer:Buffer.from('收入\n0.1\n0.2\n')});await expect(page.locator('.attachments li')).toContainText('数据.csv');
  await page.getByLabel('团队任务').fill('用后端工具计算附件收入合计，单位元。');await page.getByRole('button',{name:'提交任务'}).click();await expect(page.locator('.task-result')).toContainText('两行收入合计0.3元');await expect(page.locator('[data-tool-name="spreadsheet.aggregate"]')).toHaveAttribute('data-tool-status','completed');await page.locator('[data-tool-name="spreadsheet.aggregate"] summary').click();await expect(page.locator('.tool-calls pre')).toContainText('"value": "0.3"');await expect(page.locator('.task-result')).toContainText('任务资料：数据.csv');expect(store.list()[0].allowWeb).toBeUndefined();
  await page.reload();await expect(page.locator('.task-result')).toContainText('两行收入合计0.3元');await expect(page.locator('[data-tool-name="spreadsheet.aggregate"]')).toHaveAttribute('data-tool-status','completed');await expect(page.locator('.roster .IDLE')).toHaveCount(6);
 }finally{await page.goto('about:blank');server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(directory,{recursive:true,force:true});if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});

test('explicit web permission allows search and renders actual returned citation link',async({page})=>{
 const store=new TaskStore(':memory:');let calls=0,searches=0;
 const runtime=new AgentRuntime(store,{async complete(){calls++;if(calls===1)return JSON.stringify({action:'execute',question:'',scopeNote:'',steps:[{id:'policy',agentId:'policy',instruction:'核对公开资料',dependsOn:[]}]});if(calls===2)return JSON.stringify({toolCall:{name:'web.search',input:{query:'测试公开资料'}}});if(calls===3)return JSON.stringify({status:'completed',output:'测试来源资料',question:''});return '资料汇总';},async searchWeb(){searches++;return{text:'明确注入的 TEST 搜索资料',citations:[{url:'https://example.com/source',title:'来源页面'}],searchedAt:new Date().toISOString()};}}),server=createApp(runtime).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw new Error('Missing port');const url=`http://127.0.0.1:${address.port}`,previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN=url;
 try{await page.goto(url);await expect(page.getByRole('status')).toContainText('Runtime 已连接');const permission=page.getByRole('checkbox',{name:/允许联网查询/});await expect(permission).not.toBeChecked();await permission.check();await page.getByLabel('团队任务').fill('查询公开网页资料');await page.getByRole('button',{name:'提交任务'}).click();await expect(page.locator('.task-result')).toContainText('资料汇总');await page.locator('[data-tool-name="web.search"] summary').click();await expect(page.getByRole('link',{name:'来源页面'})).toHaveAttribute('href','https://example.com/source');expect(store.list()[0].allowWeb).toBe(true);expect(searches).toBe(1);await expect(page.locator('.roster .IDLE')).toHaveCount(6);}
 finally{await page.goto('about:blank');server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});
