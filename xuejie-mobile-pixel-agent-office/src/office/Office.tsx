import {useEffect,useRef} from 'react';
import {agents,agentEventBus,type AgentStatus,type AgentId,type AgentStateEvent} from '../runtime/model';
import {blocked,findPath,homes,stations,width,height,type Point} from './navigation';
import frames from './sprite-frames.json';
const tile=24;
const colors:Record<AgentStatus,string>={IDLE:'#8a9aab',THINKING:'#8c7be8',WALKING:'#5795cb',WORKING:'#43a48a',WAITING:'#d4a449',DONE:'#65a356',ERROR:'#d56c6c'};
export interface OfficeSnapshot {id:AgentId;status:AgentStatus;moving:boolean;blocked:boolean}
export function Office({onUpdate,onAsset}: {onUpdate:(s:OfficeSnapshot[])=>void;onAsset:(ok:boolean)=>void}) {
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const ctx=canvas.current!.getContext('2d')!;ctx.imageSmoothingEnabled=false;
  const figures=agents.map((a,i)=>({id:a.id,status:'IDLE' as AgentStatus,sequence:-1,pos:{...homes[i]},target:{...homes[i]},moving:false,blocked:false,direction:'down' as 'up'|'down'|'left'|'right',step:undefined as Point|undefined}));
  let assetReady=false,alive=true;const sprite=new Image();sprite.onload=()=>{if(alive){assetReady=true;onAsset(true);}};sprite.onerror=()=>{if(alive)onAsset(false);};sprite.src='/sprites/atlas.png';
  const notify=()=>onUpdate(figures.map(f=>({id:f.id,status:f.status,moving:f.moving,blocked:f.blocked})));
  const off=agentEventBus.subscribe((e:AgentStateEvent)=>{const index=agents.findIndex(a=>a.id===e.agentId);const f=figures[index];if(e.sequence<=f.sequence)return;f.sequence=e.sequence;f.status=e.status;f.target={...(e.status==='WORKING'?stations[index]:e.status==='WALKING'?{x:19,y:3+index*2}:homes[index])};f.blocked=false;notify();});
  const rect=(x:number,y:number,w:number,h:number,c:string)=>{ctx.fillStyle=c;ctx.fillRect(x,y,w,h);};
  let last=0,animation=0;const speed=2.8;
  function draw(time:number){const dt=Math.min((time-last)/1000,.05);last=time;
   for(const f of figures){const dx=f.target.x-f.pos.x,dy=f.target.y-f.pos.y;const was=f.moving;
    if(Math.abs(dx)+Math.abs(dy)<.005){f.pos={...f.target};f.moving=false;f.blocked=false;}
    else {const start={x:Math.round(f.pos.x),y:Math.round(f.pos.y)};const occupied=figures.filter(o=>o!==f).map(o=>({x:Math.round(o.pos.x),y:Math.round(o.pos.y)}));
     // Finish current tile segment before replanning. Reserve both occupied and next cells.
     const fstep=(f as typeof f&{step?:Point});
     if(!fstep.step){const path=findPath(start,f.target,occupied.concat(figures.filter(o=>o!==f).flatMap(o=>{const step=(o as typeof o&{step?:Point}).step;return step?[step]:[];})));fstep.step=path?.[0];}
     const next=fstep.step;f.blocked=!next;f.moving=!!next;
     if(next){f.direction=next.x>f.pos.x?'right':next.x<f.pos.x?'left':next.y>f.pos.y?'down':'up';const distance=Math.abs(next.x-f.pos.x)+Math.abs(next.y-f.pos.y);const amount=Math.min(speed*dt,distance);if(distance<=amount){f.pos={...next};delete fstep.step;}else{f.pos.x+=(next.x-f.pos.x)/distance*amount;f.pos.y+=(next.y-f.pos.y)/distance*amount;}}
    } if(was!==f.moving)notify();
   }
   rect(0,0,width*tile,height*tile,'#c6d4dc');
   for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++)rect(x*tile,y*tile,tile,tile,(x+y)%2?'#eee9dc':'#e9e4d7');
   for(let y=1;y<16;y++)if(y!==5&&y!==12){rect(21*tile,y*tile,6,tile,'#a5b5be');rect(21*tile+6,y*tile,4,tile,'#d6e0e4');}
   for(let x=22;x<29;x++)if(x!==25)rect(x*tile,8*tile,tile,6,'#a5b5be');
   ctx.font='12px monospace';ctx.fillStyle='#657480';ctx.fillText('会议室',23*tile,2*tile);ctx.fillText('休息区',23*tile,10*tile);ctx.fillText('茶水区',23*tile,16*tile);
   rect(24*tile,3*tile,4*tile,2*tile,'#a67e57');rect(24*tile+4,3*tile+4,4*tile-8,2*tile-8,'#d4b188');
   for(const x of [23,28])for(const y of [3,4]){rect(x*tile+5,y*tile+3,14,18,'#7c99ad');}
   rect(24*tile,11*tile,4*tile,tile,'#718e97');rect(24*tile+4,11*tile+3,4*tile-8,15,'#9bb5ba');rect(25*tile,13*tile,2*tile,19,'#b89979');
   rect(24*tile,17*tile,4*tile,tile,'#a8bbc0');rect(24*tile+4,17*tile+3,4*tile-8,5,'#e6edf0');rect(25*tile,17*tile+9,13,12,'#526677');rect(27*tile,17*tile+9,12,9,'#e3eced');
   stations.forEach((p,i)=>{if(assetReady&&figures[i].status==='WORKING'&&!figures[i].moving&&figures[i].pos.x===p.x&&figures[i].pos.y===p.y)return;const x=(p.x-1)*tile,y=(p.y-1)*tile;rect(x+2,y+3,68,22,'#8d694a');rect(x+2,y+3,68,17,'#cfaa7d');rect(p.x*tile+1,y-2,22,15,'#384d63');rect(p.x*tile+4,y+1,16,9,'#9bc8da');rect(p.x*tile+6,y+14,14,3,'#55616b');rect(p.x*tile+3,p.y*tile+6,18,16,'#819bad');ctx.fillStyle='#5a6775';ctx.font='10px sans-serif';ctx.fillText(agents[i].name,x+3,y-9);});
   figures.forEach((f,i)=>{const x=f.pos.x*tile+12,y=f.pos.y*tile+12;ctx.fillStyle='#b5afa2';ctx.beginPath();ctx.ellipse(x,y+13,12,4,0,0,Math.PI*2);ctx.fill();
    if(assetReady){
     const seated=f.status==='WORKING'&&!f.moving&&f.pos.x===stations[i].x&&f.pos.y===stations[i].y;
     const pose=f.moving?f.direction:seated?'working':f.status==='DONE'?'done':'idle';
     const choices=frames[i][pose];const frame=choices[Math.floor(time/(pose==='working'?420:180))%choices.length];
     // DONE poses are alternatives, not animation frames; keep the first pose stable.
     const selected=pose==='done'?choices[0]:frame;
     const scale=seated?.72:.65;const dw=Math.round(selected.w*scale),dh=Math.round(selected.h*scale);
     ctx.drawImage(sprite,selected.x,selected.y,selected.w,selected.h,Math.round(x-dw/2),Math.round(y+14-dh),dw,dh);
    }
    else {rect(x-13,y-11,26,25,'#f7f7f2');ctx.strokeStyle='#9aa9b5';ctx.setLineDash([3,3]);ctx.strokeRect(x-13,y-11,26,25);ctx.setLineDash([]);ctx.fillStyle='#687b8f';ctx.font='11px monospace';ctx.fillText(String(i+1).padStart(2,'0'),x-7,y+5);}
    rect(x+18,y-35,5,5,colors[f.status]);if(f.status!=='IDLE'){ctx.fillStyle=colors[f.status];ctx.font='9px monospace';ctx.fillText(f.status,x-22,y-53);}
   });
   animation=requestAnimationFrame(draw);
  }
  notify();animation=requestAnimationFrame(draw);return()=>{alive=false;off();cancelAnimationFrame(animation);};
 },[onUpdate,onAsset]);
 return <canvas ref={canvas} width={width*tile} height={height*tile} aria-label="2D 顶视角办公室，六个固定工位，会议室、休息区与茶水区"/>;
}
