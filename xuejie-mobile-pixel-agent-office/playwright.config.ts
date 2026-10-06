import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',use:{browserName:'chromium',viewport:{width:1280,height:1100},launchOptions:{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}},reporter:'list'});
