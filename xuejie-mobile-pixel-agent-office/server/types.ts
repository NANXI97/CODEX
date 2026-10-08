import type {AgentId, AgentStatus} from '../src/runtime/model';
export const specialistIds = ['customer', 'design', 'translator', 'data', 'policy'] as const;
export type SpecialistId = typeof specialistIds[number];
export type TaskStatus = 'queued' | 'running' | 'needs_input' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'waiting' | 'running' | 'completed' | 'failed' | 'blocked' | 'needs_input';
export interface StepDefinition {id: string; agentId: SpecialistId; instruction: string; dependsOn: string[]}
export interface Calculation {label: string; value: string; unit: string; formula: string}
export interface StepResult {output: string; calculations?: Calculation[]}
export interface TaskStep extends StepDefinition {
 status: StepStatus; output?: string; calculations?: Calculation[]; error?: string; question?: string;
 startedAt?: string; completedAt?: string;
}
export interface ExecutionPlan {action: 'execute' | 'clarify' | 'unsupported'; steps: StepDefinition[]; question: string; scopeNote: string}
export interface Task {
 id: string; input: string; status: TaskStatus; createdAt: string; updatedAt: string;
 result?: string; translation?: string; error?: string; question?: string; parentId?: string;
 steps?: TaskStep[]; scopeNote?: string;
}
export interface AgentContext {input: string; instruction: string; dependencies: Record<string, StepResult>}
export interface LLMRequest {system: string; user: string; json?: boolean}
export interface LLMProvider {complete(request: LLMRequest): Promise<string>}
export interface Tool {name: string; description: string; execute(input: unknown): Promise<unknown>}
export interface Agent {id: AgentId; tools: readonly Tool[]}
export interface SpecialistAgent extends Agent {id: SpecialistId; execute(context: AgentContext): Promise<StepResult>}
export type RuntimeEvent =
 | {sequence: number; timestamp: string; kind: 'agent'; agentId: AgentId; status: AgentStatus; source: 'runtime'; taskId?: string}
 | {sequence: number; timestamp: string; kind: 'task'; task: Task};
