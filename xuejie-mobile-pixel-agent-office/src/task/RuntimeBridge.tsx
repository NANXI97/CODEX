import {useEffect,useState}from'react';
import {agentEventBus,type AgentStateEvent}from'../runtime/model';
export interface Task {id:string;input:string;status:'queued'|'running'|'needs_input'|'completed'|'failed';result?:string;translation?:string;error?:string;question?:string;createdAt:string;updatedAt:string}
export function useRuntime(){const [connected,setConnected]=useState(false),[configured,setConfigured]=useState(false),[tasks,setTasks]=useState<Task[]>([]);
 useEffect(()=>{let alive=true;const stream=new EventSource('/api/events');
  const health=()=>fetch('/api/health').then(r=>r.ok?r.json():Promise.reject()).then(r=>{if(alive)setConfigured(r.llmConfigured===true);}).catch(()=>{if(alive)setConfigured(false);});void health();
  stream.addEventListener('snapshot',e=>{try{const data=JSON.parse((e as MessageEvent).data);for(const event of data.agents)agentEventBus.publish(event as AgentStateEvent);setTasks(data.tasks);setConnected(true);void health();}catch{setConnected(false);}});
  stream.addEventListener('agent',e=>{try{agentEventBus.publish(JSON.parse((e as MessageEvent).data));}catch{setConnected(false);}});
  stream.addEventListener('task',e=>{try{const event=JSON.parse((e as MessageEvent).data);setTasks(previous=>[event.task,...previous.filter(t=>t.id!==event.task.id)].slice(0,100));}catch{setConnected(false);}});
  stream.onerror=()=>setConnected(false);return()=>{alive=false;stream.close();};
 },[]);return{connected,configured,tasks};
}
export function TaskPanel(){const {connected,configured,tasks}=useRuntime();const [input,setInput]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState(''),[activeId,setActiveId]=useState<string>();
 async function submit(){if(!input.trim()||sending)return;setSending(true);setError('');try{const response=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input,...(activeId&&tasks.find(t=>t.id===activeId)?.status==='needs_input'?{parentId:activeId}:{})})});const data=await response.json();if(!response.ok)throw new Error(data.error??'提交失败。');setActiveId(data.id);setInput('');}catch(e){setError(e instanceof Error?e.message:'网络请求失败。');}finally{setSending(false);}}
 const active=tasks.find(t=>t.id===activeId)??tasks[0];
 const labels={queued:'等待执行',running:'正在执行',needs_input:'需要补充信息',completed:'已完成',failed:'执行失败'};
 return <section className="runtime-panel"><form className="input" onSubmit={e=>{e.preventDefault();void submit();}}><textarea value={input} maxLength={12000} onChange={e=>setInput(e.target.value)} placeholder="交给 AI 团队……粘贴原文并说明目标语言" aria-label="翻译任务" rows={3}/><button disabled={!connected||!configured||!input.trim()||sending}>{sending?'提交中…':'提交任务'}</button><p role="status">{!connected?'正在连接 Agent Runtime…':!configured?'模型尚未配置，暂不能执行真实任务。':'Runtime 已连接 · Manager → Translator · 仅支持翻译'}</p></form>
 {error&&<p role="alert">{error}</p>}
 {active&&<article className="task-result"><label>任务记录 <select value={active.id} onChange={e=>setActiveId(e.target.value)}>{tasks.map(t=><option key={t.id} value={t.id}>{labels[t.status]} · {t.input.slice(0,30)}</option>)}</select></label><p>{labels[active.status]}</p><p className="task-input">{active.input}</p>{active.error&&<p role="alert">{active.error}</p>}{active.question&&<p>{active.question} 在输入框中补充完整原文和目标语言后重新提交。</p>}{active.status==='completed'&&<pre>{active.result}</pre>}{active.translation&&<details><summary>Translator 原始译文</summary><pre>{active.translation}</pre></details>}</article>}
 </section>;
}
