import {agents} from '../runtime/model';
import type {TaskStep} from '../../server/types';
import './Workflow.css';
const labels = {pending: '等待调度', waiting: '等待上游', running: '正在执行', completed: '已完成', failed: '执行失败', blocked: '未执行', needs_input: '需要补充信息'};
export function Workflow({steps}: {steps?: TaskStep[]}) {
 if (!steps?.length) return null;
 return <section className="workflow" aria-label="团队执行步骤">
  <p>团队流程 · {steps.filter(s => s.status === 'completed').length}/{steps.length} 步完成</p>
  <ol>{steps.map(step => {
   const agent = agents.find(a => a.id === step.agentId)!;
   return <li key={step.id} data-step-id={step.id} data-step-status={step.status}>
    <div><strong>{agent.name} · {agent.role}</strong><span>{labels[step.status]}</span></div>
    <p>{step.instruction}</p>
    {step.dependsOn.length > 0 && <small>依赖：{step.dependsOn.map(id => {const upstream = steps.find(s => s.id === id)!; return `${agents.find(a => a.id === upstream.agentId)!.name}（${id}）`;}).join('、')}</small>}
    {(step.error || step.question) && <p>{step.error || step.question}</p>}
    {step.output && <details><summary>查看实际结果{step.calculations?.length ? '与计算式' : ''}</summary><pre>{step.output}</pre></details>}
   </li>;
  })}</ol>
 </section>;
}
