import {test,expect} from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TaskStore} from '../server/store';
import {AgentRuntime} from '../server/runtime';
import {FileStore} from '../server/files';
import {createApp} from '../server/app';

for(const viewport of [{width:1280,height:1080},{width:390,height:844}]){
 test(`private office login, real snapshot and task controls at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);
  const dir=mkdtempSync(join(tmpdir(),'xuejie-browser-access-')),store=new TaskStore(':memory:'),runtime=new AgentRuntime(store,null,{files:new FileStore(dir)});
  const task=store.create('An existing private policy record');store.update(task.id,{status:'completed',result:'Existing result from the store'});
  const password='a-local-browser-test-password';
  const app=createApp(runtime,{password,origin:'http://localhost:5173',database:':memory:',secure:false});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test port');const url=`http://127.0.0.1:${address.port}`;
  // The test origin is known only after the OS binds the ephemeral port.
  // Use the same HTTP app and exact Origin the browser will send.
  app.locals.closeAccess();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  const protectedApp=createApp(runtime,{password,origin:url,database:':memory:',secure:false}),protectedServer=protectedApp.listen(address.port,'127.0.0.1');await new Promise<void>(resolve=>protectedServer.once('listening',resolve));
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(url);await expect(page.getByRole('button',{name:'进入工作室'})).toBeVisible();await expect(page.locator('canvas')).toHaveCount(0);await expect(page.getByText('An existing private policy record')).toHaveCount(0);
   await page.getByLabel('工作室登录密码').fill('wrong');await page.getByRole('button',{name:'进入工作室'}).click();await expect(page.getByRole('alert')).toContainText('密码不正确');
   await page.getByLabel('工作室登录密码').fill(password);await page.getByRole('button',{name:'进入工作室'}).click();await expect(page.locator('canvas')).toBeVisible();await expect(page.locator('.foot')).toContainText('已载入用户母版');await expect(page.locator('.roster article')).toHaveCount(6);await expect(page.locator('.task-result')).toContainText('Existing result from the store');await expect(page.locator('.dev')).toHaveCount(0);
   await page.getByLabel('团队任务').fill('A draft, never submitted to a model');await expect(page.getByLabel('团队任务')).toBeVisible();await expect(page.getByRole('button',{name:'提交任务'})).toBeDisabled();
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);expect(overflow).toBe(false);
   await page.reload();await expect(page.locator('canvas')).toBeVisible();await expect(page.locator('.task-result')).toContainText('Existing result from the store');
   await page.getByRole('button',{name:'退出登录'}).click();await expect(page.getByRole('button',{name:'进入工作室'})).toBeVisible();await expect(page.locator('canvas')).toHaveCount(0);await page.reload();await expect(page.getByRole('button',{name:'进入工作室'})).toBeVisible();expect(errors).toEqual([]);
  }finally{protectedServer.closeAllConnections();await new Promise<void>(resolve=>protectedServer.close(()=>resolve()));protectedApp.locals.closeAccess();store.close();rmSync(dir,{recursive:true,force:true});}
 });
}
