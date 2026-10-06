// Deterministic extraction only: original RGB values are never recolored or regenerated.
import {PNG} from 'pngjs';
import {readFileSync,writeFileSync} from 'node:fs';
const original=PNG.sync.read(readFileSync('public/sprites/sprite-sheet.png'));
const borders=[[84,140,192,246,303],[314,389,463,535],[544,617,692,763],[772,847,922,994],[1002,1075,1150,1221],[1231,1304,1377,1447]];
const rows={idle:[414,477],down:[481,541],up:[544,607],left:[611,675],right:[680,742],working:[745,835],done:[844,921]};
const atlas=new PNG({width:24*112,height:6*96});const metadata=[];
for(let agent=0;agent<6;agent++){
 let slot=0;const poses={};
 for(const [pose,[top,bottom]] of Object.entries(rows)){
  const edges=pose==='left'&&agent===0?[84,148,210,303]:pose==='left'||pose==='right'&&agent!==0?[borders[agent][0],borders[agent][0]+70,borders[agent][0]+140,borders[agent].at(-1)]:pose==='working'||pose==='done'?[borders[agent][0],(borders[agent][0]+borders[agent].at(-1))/2,borders[agent].at(-1)]:borders[agent];
  poses[pose]=[];
  for(let frame=0;frame<edges.length-1;frame++){
   const left=Math.ceil(edges[frame])+2,right=Math.floor(edges[frame+1])-2,w=right-left,h=bottom-top;
   const data=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const source=((y+top)*original.width+x+left)*4;original.data.copy(data,(y*w+x)*4,source,source+4);}
   // Remove only edge-connected light paper background. Dark sprite outlines protect enclosed white fur.
   const seen=new Uint8Array(w*h),queue=[];
   const enqueue=(x,y)=>{const k=y*w+x;if(seen[k])return;seen[k]=1;const j=k*4;if(Math.min(data[j],data[j+1],data[j+2])>155){queue.push(k);data[j+3]=0;}};
   for(let x=0;x<w;x++){enqueue(x,0);enqueue(x,h-1);}for(let y=0;y<h;y++){enqueue(0,y);enqueue(w-1,y);}
   for(let i=0;i<queue.length;i++){const x=queue[i]%w,y=Math.floor(queue[i]/w);if(x>0)enqueue(x-1,y);if(x+1<w)enqueue(x+1,y);if(y>0)enqueue(x,y-1);if(y+1<h)enqueue(x,y+1);}
   let minx=w,miny=h,maxx=0,maxy=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]){minx=Math.min(minx,x);miny=Math.min(miny,y);maxx=Math.max(maxx,x);maxy=Math.max(maxy,y);}
   const fw=maxx-minx+1,fh=maxy-miny+1,ax=slot++*112,ay=agent*96;
   for(let y=0;y<fh;y++)for(let x=0;x<fw;x++){const src=((y+miny)*w+x+minx)*4;data.copy(atlas.data,((ay+y)*atlas.width+ax+x)*4,src,src+4);}
   poses[pose].push({x:ax,y:ay,w:fw,h:fh,sourceX:left+minx,sourceY:top+miny});
  }
 }
 metadata.push(poses);
}
writeFileSync('public/sprites/atlas.png',PNG.sync.write(atlas));
writeFileSync('src/office/sprite-frames.json',JSON.stringify(metadata,null,2));
