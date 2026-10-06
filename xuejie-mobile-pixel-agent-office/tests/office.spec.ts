import {test,expect} from '@playwright/test';
test('office loads and all six agents move to and return from their stations',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://localhost:5173/?visualTest=1');await expect(page.locator('canvas')).toBeVisible();await expect(page.locator('.foot')).toContainText('已载入用户母版');
 await expect(page.locator('.roster article')).toHaveCount(6);
 await expect(page.locator('textarea')).toHaveCount(0);
 const selectors=page.locator('select');for(let i=0;i<6;i++)await selectors.nth(i).selectOption('WORKING');
 await expect(page.locator('.roster')).toContainText('移动中');
 await expect.poll(()=>page.locator('.roster').innerText()).not.toContain('移动中');
 await expect(page.locator('.roster .WORKING')).toHaveCount(6);await page.screenshot({path:'artifacts/phase1-working.png',fullPage:true});
 for(let i=0;i<6;i++)await selectors.nth(i).selectOption('IDLE');
 await expect.poll(()=>page.locator('.roster').innerText()).not.toContain('移动中');
 await selectors.nth(3).selectOption('WALKING');await expect(page.locator('.roster')).toContainText('移动中');await expect.poll(()=>page.locator('.roster').innerText(),{timeout:15000}).not.toContain('移动中');await selectors.nth(3).selectOption('IDLE');await expect.poll(()=>page.locator('.roster').innerText(),{timeout:15000}).not.toContain('移动中');await selectors.nth(3).selectOption('ERROR');await expect(page.locator('.roster .ERROR')).toHaveCount(1);
 await selectors.nth(3).selectOption('IDLE');
 await page.screenshot({path:'/workspace/CODEX/xuejie-mobile-pixel-agent-office/artifacts/phase1.png',fullPage:true});
 expect(errors).toEqual([]);
});
test('production has no development controls',async({page})=>{await page.goto('http://127.0.0.1:3001');await expect(page.locator('canvas')).toBeVisible();await expect(page.locator('.dev')).toHaveCount(0);await expect(page.locator('.dev select')).toHaveCount(0);});
