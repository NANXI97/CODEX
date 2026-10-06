import {PNG}from'pngjs';import{readFileSync}from'node:fs';import assert from'node:assert/strict';
const original=PNG.sync.read(readFileSync('public/sprites/sprite-sheet.png')),atlas=PNG.sync.read(readFileSync('public/sprites/atlas.png')),metadata=JSON.parse(readFileSync('src/office/sprite-frames.json','utf8'));
let pixels=0;
for(const agent of metadata)for(const frames of Object.values(agent))for(const f of frames){assert.ok(f.w>0&&f.h>0);for(let y=0;y<f.h;y++)for(let x=0;x<f.w;x++){const a=((f.y+y)*atlas.width+f.x+x)*4;if(!atlas.data[a+3])continue;const o=((f.sourceY+y)*original.width+f.sourceX+x)*4;assert.deepEqual(atlas.data.subarray(a,a+3),original.data.subarray(o,o+3));pixels++;}}
console.log(`Sprite integrity passed: ${pixels} visible pixels retain exact source RGB.`);
