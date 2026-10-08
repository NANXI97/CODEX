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
 startedAt?: string; completedAt?: string; toolCalls?: ToolCallRecord[];
}
export interface ExecutionPlan {action: 'execute' | 'clarify' | 'unsupported'; steps: StepDefinition[]; question: string; scopeNote: string}
export interface Task {
 id: string; input: string; status: TaskStatus; createdAt: string; updatedAt: string;
 result?: string; translation?: string; error?: string; question?: string; parentId?: string;
 steps?: TaskStep[]; scopeNote?: string; attachments?: FileAttachment[]; allowWeb?: boolean;
}
export interface FileAttachment {id: string; name: string; format: 'txt' | 'md' | 'csv' | 'xlsx'; size: number; sha256: string}
export interface Citation {url: string; title: string}
export interface WebSearchResult {text: string; citations: Citation[]; searchedAt: string}
export interface ToolCallRecord {
 id: string; name: string; input: unknown; status: 'running' | 'completed' | 'failed';
 startedAt: string; completedAt?: string; output?: unknown; error?: string;
}
export interface ToolContext {attachments: readonly FileAttachment[]; allowWeb?: boolean}
export interface AgentContext {
 input: string; instruction: string; dependencies: Record<string, StepResult>; attachments?: FileAttachment[]; allowWeb?: boolean;
 onToolCall?: (record: ToolCallRecord) => void;
}
export interface LLMRequest {system: string; user: string; json?: boolean; jsonSchema?: {name: string; schema: Record<string, unknown>}}
export interface LLMProvider {complete(request: LLMRequest): Promise<string>; searchWeb?(query: string): Promise<WebSearchResult>}
export interface Tool {name: string; description: string; inputSchema: Record<string, unknown>; execute(input: unknown, context: ToolContext): Promise<unknown>}
export interface Agent {id: AgentId; tools: readonly Tool[]}
export interface SpecialistAgent extends Agent {id: SpecialistId; execute(context: AgentContext): Promise<StepResult>}
export type RuntimeEvent =
 | {sequence: number; timestamp: string; kind: 'agent'; agentId: AgentId; status: AgentStatus; source: 'runtime'; taskId?: string}
 | {sequence: number; timestamp: string; kind: 'task'; task: Task};
