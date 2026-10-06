import type {AgentId,AgentStatus} from '../src/runtime/model';
export type TaskStatus='queued'|'running'|'needs_input'|'completed'|'failed';
export interface Task {id:string;input:string;status:TaskStatus;createdAt:string;updatedAt:string;result?:string;translation?:string;error?:string;question?:string;parentId?:string}
export interface TranslationPlan {action:'translate'|'clarify'|'unsupported';sourceText:string;targetLanguage:string;question:string}
export interface LLMRequest {system:string;user:string;json?:boolean}
export interface LLMProvider {complete(request:LLMRequest):Promise<string>}
export interface Tool {name:string;description:string;execute(input:unknown):Promise<unknown>}
export interface Agent {id:AgentId;tools:readonly Tool[]}
export type RuntimeEvent={sequence:number;timestamp:string;kind:'agent';agentId:AgentId;status:AgentStatus;source:'runtime';taskId?:string}|{sequence:number;timestamp:string;kind:'task';task:Task};
