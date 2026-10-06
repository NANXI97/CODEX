import {test,expect}from'@playwright/test';
import{TaskStore}from'../server/store';import{AgentRuntime}from'../server/runtime';import{createApp}from'../server/app';import type{LLMProvider}from'../server/types';
test('UI connects to real HTTP/SSE runtime with an explicitly injected TEST provider',async({page})=>{
 const store=new TaskStore(':memory:');const completions:((text:string)=>void)[]=[];
 const provider:LLMProvider={complete:()=>new Promise(resolve=>completions.push(resolve))};
 const runtime=new AgentRuntime(store,provider),server=createApp(runtime).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test port');const url=`http://127.0.0.1:${address.port}`;const previousOrigin=process.env.APP_ORIGIN;process.env.APP_ORIGIN=url;
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(url);await expect(page.getByRole('status')).toContainText('Runtime 已连接');await expect(page.locator('.dev')).toHaveCount(0);
  await page.getByLabel('翻译任务').fill('翻译成中文：월 33,000원. 약정 24개월.');await page.getByRole('button',{name:'提交任务'}).click();
  await expect(page.locator('.roster article').nth(0)).toContainText('THINKING');await expect.poll(()=>completions.length).toBe(1);
  completions[0](JSON.stringify({action:'translate',sourceText:'월 33,000원. 약정 24개월.',targetLanguage:'简体中文',question:''}));
  await expect(page.locator('.roster article').nth(3)).toContainText('WORKING');await expect.poll(()=>completions.length).toBe(2);
  await expect.poll(()=>page.locator('.roster article').nth(3).innerText()).not.toContain('移动中');
  for(const i of [1,2,4,5])await expect(page.locator('.roster article').nth(i)).toContainText('IDLE');
  completions[1]('每月 33,000 韩元，合约期 24 个月。');await expect.poll(()=>completions.length).toBe(3);await expect(page.locator('.roster article').nth(0)).toContainText('WORKING');
  completions[2]('每月 33,000 韩元，合约期 24 个月。');await expect(page.locator('.task-result')).toContainText('已完成');await expect(page.locator('.task-result pre').first()).toHaveText('每月 33,000 韩元，合约期 24 个月。');
  await page.reload();await expect(page.locator('.task-result')).toContainText('已完成');await expect(page.getByRole('status')).toContainText('Runtime 已连接');expect(errors).toEqual([]);
 }finally{await page.goto('about:blank');server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();if(previousOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previousOrigin;}
});
test('unconfigured production runtime does not pretend to execute tasks',async({page})=>{await page.goto('http://127.0.0.1:3001');await expect(page.getByRole('status')).toContainText('模型尚未配置');await expect(page.getByRole('button',{name:'提交任务'})).toBeDisabled();await expect(page.locator('.roster .IDLE')).toHaveCount(6);});
