export const statuses = ['IDLE','THINKING','WALKING','WORKING','WAITING','DONE','ERROR'] as const;
export type AgentStatus = typeof statuses[number];
export const agents = [
 {id:'manager',name:'黑柴',role:'总控 / 店长'},
 {id:'customer',name:'马尔济斯',role:'客服'},
 {id:'design',name:'黄柴',role:'设计 / 内容'},
 {id:'translator',name:'灰白猫',role:'翻译'},
 {id:'data',name:'橘猫',role:'数据'},
 {id:'policy',name:'三花猫',role:'政策 / 资料'},
] as const;
export type AgentId = typeof agents[number]['id'];
export interface AgentStateEvent { agentId:AgentId; status:AgentStatus; sequence:number; source:'runtime'|'development'; taskId?:string }
// UI consumes events only. A future runtime bridge publishes here; no business logic belongs in the office.
export class AgentEventBus {
 private listeners = new Set<(event:AgentStateEvent)=>void>();
 publish(event:AgentStateEvent) { if (!agents.some(a=>a.id===event.agentId)||!statuses.includes(event.status)||!Number.isSafeInteger(event.sequence)||event.sequence<0) throw new Error('Invalid agent event'); this.listeners.forEach(listener=>listener(event)); }
 subscribe(listener:(event:AgentStateEvent)=>void) { this.listeners.add(listener); return ()=>{this.listeners.delete(listener);}; }
}
export const agentEventBus = new AgentEventBus();
