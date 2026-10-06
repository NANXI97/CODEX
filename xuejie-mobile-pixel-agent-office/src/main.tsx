import React,{useState,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {Office,type OfficeSnapshot} from './office/Office';
import {agents,statuses,agentEventBus,type AgentStatus} from './runtime/model';
import './style.css';
import {TaskPanel} from './task/RuntimeBridge';
const visualTest=import.meta.env.DEV&&new URLSearchParams(location.search).get('visualTest')==='1';
let sequence=Date.now();
function App(){const [snapshot,setSnapshot]=useState<OfficeSnapshot[]>([]);const [asset,setAsset]=useState(false);const update=useCallback((s:OfficeSnapshot[])=>setSnapshot(s),[]);const assetUpdate=useCallback((ok:boolean)=>setAsset(ok),[]);
 return <main><header><div className="brandmark">▦</div><div><h1>学姐通信 <span>XUEJIE MOBILE</span></h1><p>Good Ideas, Better Life</p></div><div className="phase">PIXEL AGENT OFFICE<br/><small>PHASE 02 · REAL AGENT RUNTIME</small></div></header>
 <section className="office"><div className="bar"><span>AI 团队办公室</span><span className="muted">6 AGENTS · 状态事件驱动</span></div><Office onUpdate={update} onAsset={assetUpdate}/><div className="foot">{asset?'角色素材：已载入用户母版':'角色素材待接入 · 当前数字方框为占位，不代表最终角色'}<span>2D TOP VIEW</span></div></section>
 <section className="roster">{agents.map(a=>{const s=snapshot.find(s=>s.id===a.id);return <article key={a.id}><strong>{a.name}</strong><small>{a.role} Agent</small><div className={'status '+(s?.status??'IDLE')}>{s?.status??'IDLE'}{s?.moving?' · 移动中':''}{s?.blocked?' · 路径受阻':''}</div></article>;})}</section>
 {!visualTest&&<TaskPanel/>}
 {visualTest&&<details className="dev" open><summary>开发测试面板 · 手动状态事件（非真实任务执行）</summary><div className="controls">{agents.map(a=><label key={a.id}>{a.name}<select value={snapshot.find(s=>s.id===a.id)?.status??'IDLE'} onChange={e=>agentEventBus.publish({agentId:a.id,status:e.target.value as AgentStatus,sequence:++sequence,source:'development'})}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label>)}</div><p>WORKING → 前往专属工位；WALKING → 前往通道；其他状态 → 返回待机位置。移动是表现层，状态不被动画改写。DONE 不会自动变成 IDLE，需下一条状态事件。</p></details>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
