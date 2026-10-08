import type {FileAttachment, ToolCallRecord} from '../../server/types';
import './Attachments.css';

export function Attachments({files,onChange,busy,onBusy,onError,allowWeb,onWeb}: {
 files:FileAttachment[];onChange:(files:FileAttachment[])=>void;busy:boolean;onBusy:(value:boolean)=>void;onError:(message:string)=>void;allowWeb:boolean;onWeb:(value:boolean)=>void;
}) {
 async function upload(selected:FileList|null) {
  if(!selected?.length)return;
  if(selected.length+files.length>4){onError('每个任务最多附加四个文件。');return;}
  onBusy(true);onError('');const added:FileAttachment[]=[];
  try {
   for(const file of Array.from(selected)) {
    if(file.size>5*1024*1024)throw new Error('单个文件不能超过 5 MB。');
    const response=await fetch('/api/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});
    const data=await response.json();if(!response.ok)throw new Error(data.error??'上传失败。');added.push(data);
   }
  } catch(e){onError(e instanceof Error?e.message:'文件上传失败。');}
  finally{onChange([...files,...added]);onBusy(false);}
 }
 return <div className="attachments">
  <label>添加资料 <input type="file" accept=".txt,.md,.csv,.xlsx" multiple disabled={busy} onChange={e=>{void upload(e.target.files);e.target.value='';}} aria-label="添加资料"/></label>
  <small>TXT／MD／CSV／XLSX · 每个文件 ≤5 MB · 最多四个</small>
  {files.length>0&&<ul>{files.map(file=><li key={file.id}><span>{file.name}</span><button type="button" disabled={busy} onClick={()=>onChange(files.filter(f=>f.id!==file.id))} aria-label={`移除 ${file.name}`}>移除</button></li>)}</ul>}
  <label className="web-permission"><input type="checkbox" checked={allowWeb} disabled={busy} onChange={e=>onWeb(e.target.checked)}/>允许联网查询 <small>搜索会产生 API 费用</small></label>
  {busy&&<small>正在上传并检查资料…</small>}
 </div>;
}
function sources(output:unknown):{url:string;title:string}[] {
 if(!output||typeof output!=='object')return [];
 const data=output as {url?:string;title?:string;citations?:{url:string;title:string}[]};
 return [...(data.url?[{url:data.url,title:data.title??data.url}]:[]),...(Array.isArray(data.citations)?data.citations:[])].filter(c=>{try{const url=new URL(c.url);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}});
}
const toolNames:Record<string,string>={'file.read':'读取文件','spreadsheet.inspect':'检查工作表','spreadsheet.read':'读取单元格','spreadsheet.aggregate':'表格计算','web.read':'读取网页','web.search':'网页搜索'};
export function ToolCalls({calls}:{calls?:ToolCallRecord[]}) {
 if(!calls?.length)return null;
 return <div className="tool-calls" aria-label="实际工具调用">{calls.map(call=><details key={call.id} data-tool-name={call.name} data-tool-status={call.status}>
  <summary>{toolNames[call.name]??call.name} · {call.status==='completed'?'成功':call.status==='running'?'执行中':'失败'}</summary>
  <p>开始：{new Date(call.startedAt).toLocaleString()}{call.completedAt&&` · 结束：${new Date(call.completedAt).toLocaleString()}`}</p>
  {call.error&&<p role="alert">{call.error}</p>}
  {sources(call.output).map(source=><p key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></p>)}
  <pre>{JSON.stringify({input:call.input,...(call.output!==undefined?{output:call.output}:{})},null,2)}</pre>
 </details>)}</div>;
}
