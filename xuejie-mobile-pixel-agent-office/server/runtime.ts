import {agents, type AgentId, type AgentStatus} from '../src/runtime/model';
import type {LLMProvider, Task, TaskStep, RuntimeEvent, StepResult, ToolCallRecord} from './types';
import {TaskStore} from './store';
import {ProviderError} from './provider';
import {AgentRegistry, ManagerAgent, NeedsInputError, TaskRouter} from './agents';
import {FileStore} from './files';
import {ToolRegistry} from './tools';
export {AgentRegistry, ManagerAgent, TaskRouter} from './agents';

export class AgentEventBus {
 private listeners = new Set<(event: RuntimeEvent) => void>();
 subscribe(fn: (event: RuntimeEvent) => void) {this.listeners.add(fn); return () => {this.listeners.delete(fn);};}
 publish(event: RuntimeEvent) {for (const listener of this.listeners) listener(event);}
}
export class TaskQueue {
 private ids: string[] = []; private active = false;
 constructor(private execute: (id: string) => Promise<void>) {}
 push(id: string) {this.ids.push(id); void this.drain();}
 get size() {return this.ids.length;}
 get busy() {return this.active;}
 private async drain() {if (this.active) return; this.active = true; try {while (this.ids.length) await this.execute(this.ids.shift()!);} finally {this.active = false;}}
}
type State = (id: AgentId, status: AgentStatus, taskId?: string) => void;
const message = (error: unknown) => error instanceof ProviderError ? error.message : '任务执行失败，请重试。';

export class TaskExecutor {
 constructor(private manager: ManagerAgent, private registry: AgentRegistry, private router: TaskRouter,
  private store: TaskStore, private state: State, private changed: (task: Task) => void, private maxParallel: number) {}
 private update(id: string, patch: Partial<Task>) {const task = this.store.update(id, patch); this.changed(task); return task;}
 private step(id: string, stepId: string, patch: Partial<TaskStep>) {
  return this.update(id, {steps: this.store.get(id)!.steps!.map(s => s.id === stepId ? {...s, ...patch} : s)});
 }
 private context(task: Task): string {
  const inputs = [task.input]; let parentId = task.parentId; const seen = new Set([task.id]);
  while (parentId) {
   if (seen.has(parentId) || seen.size > 8) throw new ProviderError('INPUT_LIMIT', '补充信息关联过多，请重新提交完整任务。');
   seen.add(parentId); const parent = this.store.get(parentId);
   if (!parent) throw new ProviderError('INVALID_PARENT', '原任务不存在。');
   inputs.unshift(parent.input); parentId = parent.parentId;
  }
  const input = inputs.join('\n\n补充信息：\n');
  if (input.length > 24000) throw new ProviderError('INPUT_LIMIT', '补充后的文本过长，请拆分任务。');
  return input;
 }
 async execute(id: string) {
  this.update(id, {status: 'running'});
  // Release stale availability from previous terminal/clarification tasks; never use animation timers.
  for (const previous of this.store.snapshot().agents) if (previous.status !== 'IDLE') this.state(previous.agentId, 'IDLE', id);
  try {
   this.state('manager', 'THINKING', id);
   const initial = this.store.get(id)!, input = this.context(initial), attachments = initial.attachments ?? [];
   const plan = this.router.validate(await this.manager.understand(input, attachments, initial.allowWeb));
   if (plan.action !== 'execute') {
    this.update(id, {status: plan.action === 'clarify' ? 'needs_input' : 'failed', question: plan.question, scopeNote: plan.scopeNote, ...(plan.action === 'unsupported' ? {error: plan.question} : {})});
    this.state('manager', plan.action === 'clarify' ? 'WAITING' : 'ERROR', id); return;
   }
   this.update(id, {steps: plan.steps.map(s => ({...s, status: s.dependsOn.length ? 'waiting' : 'pending'})), scopeNote: plan.scopeNote});
   this.state('manager', 'WAITING', id);
   const busyAgents = new Set<AgentId>(), running = new Map<string, Promise<void>>();
   let stopped = false;
   for (const agentId of new Set(plan.steps.filter(s => s.dependsOn.length).map(s => s.agentId))) this.state(agentId, 'WAITING', id);
   const run = async (step: TaskStep) => {
    busyAgents.add(step.agentId);
    this.step(id, step.id, {status: 'running', startedAt: new Date().toISOString()});
    this.state(step.agentId, 'WORKING', id);
    let success = false;
    try {
     const current = this.store.get(id)!;
     const dependencies: Record<string, StepResult> = Object.fromEntries(step.dependsOn.map(dependency => {
      const completed = current.steps!.find(s => s.id === dependency)!;
      return [dependency, {output: completed.output!, calculations: completed.calculations}];
     }));
     const onToolCall = (record: ToolCallRecord) => {
      const previous = this.store.get(id)!.steps!.find(s => s.id === step.id)!.toolCalls ?? [];
      this.step(id, step.id, {toolCalls: [...previous.filter(call => call.id !== record.id), record]});
     };
     const result = await this.registry.specialist(step.agentId).execute({input, instruction: step.instruction, dependencies, attachments, allowWeb: initial.allowWeb, onToolCall});
     const task = this.step(id, step.id, {status: 'completed', ...result, completedAt: new Date().toISOString()});
     if (step.agentId === 'translator') this.update(id, {translation: task.steps!.filter(s => s.agentId === 'translator' && s.status === 'completed').map(s => s.output).join('\n\n')});
     success = true; this.state(step.agentId, 'DONE', id);
    } catch (error) {
     stopped = true;
     if (error instanceof NeedsInputError) {
      this.step(id, step.id, {status: 'needs_input', question: error.question}); this.state(step.agentId, 'WAITING', id);
     } else {
      this.step(id, step.id, {status: 'failed', error: message(error), completedAt: new Date().toISOString()}); this.state(step.agentId, 'ERROR', id);
     }
    } finally {
     busyAgents.delete(step.agentId);
     if (success) {
      const pending = !stopped && this.store.get(id)!.steps!.some(s => s.agentId === step.agentId && ['pending', 'waiting'].includes(s.status));
      this.state(step.agentId, pending ? 'WAITING' : 'IDLE', id);
     }
    }
   };
   while (!stopped) {
    const steps = this.store.get(id)!.steps!;
    for (const step of steps) {
     if (running.size >= this.maxParallel) break;
     if (!['pending', 'waiting'].includes(step.status) || busyAgents.has(step.agentId)) continue;
     if (!step.dependsOn.every(dependency => steps.find(s => s.id === dependency)!.status === 'completed')) continue;
     const promise = run(step).finally(() => {running.delete(step.id);}); running.set(step.id, promise);
    }
    // Agents actually assigned work but waiting for dependencies or a worker slot.
    for (const agentId of new Set(this.store.get(id)!.steps!.filter(s => ['pending', 'waiting'].includes(s.status)).map(s => s.agentId))) {
     if (!busyAgents.has(agentId)) {
      const previous = this.store.snapshot().agents.find(a => a.agentId === agentId);
      if (previous?.status !== 'WAITING') this.state(agentId, 'WAITING', id);
     }
    }
    if (!running.size) break;
    await Promise.race(running.values());
   }
   // A failure stops new scheduling; genuine in-flight requests finish before availability is released.
   await Promise.all(running.values());
   const steps = this.store.get(id)!.steps!;
   const failed = steps.find(s => s.status === 'failed'), needsInput = steps.find(s => s.status === 'needs_input');
   if (failed || needsInput) {
    for (const step of steps.filter(s => ['waiting', 'pending'].includes(s.status))) this.step(id, step.id, {status: 'blocked', error: '本次任务已停止，该步骤未执行。'});
    for (const agentId of new Set(steps.map(s => s.agentId))) {
     if (!steps.some(s => s.agentId === agentId && ['failed', 'needs_input'].includes(s.status))) this.state(agentId, 'IDLE', id);
    }
    this.update(id, failed ? {status: 'failed', error: failed.error} : {status: 'needs_input', question: needsInput!.question});
    this.state('manager', failed ? 'ERROR' : 'WAITING', id); return;
   }
   if (steps.some(s => s.status !== 'completed')) throw new ProviderError('INVALID_PLAN', '计划无法继续调度，未返回完成结果。');
   for (const file of attachments) {
    if (!steps.some(s => s.toolCalls?.some(call => call.status === 'completed' && ['file.read','spreadsheet.read','spreadsheet.aggregate','document.read'].includes(call.name) && (call.input as {fileId?:string})?.fileId === file.id))) throw new ProviderError('FILE_NOT_READ', '附加文件尚未实际读取，任务未返回成功结果。请缩小范围重试。');
   }
   this.state('manager', 'WORKING', id);
   const result = await this.manager.summarize(input, steps, plan.scopeNote);
   this.update(id, {status: 'completed', result}); this.state('manager', 'DONE', id); this.state('manager', 'IDLE', id);
  } catch (error) {
   this.state('manager', 'ERROR', id); this.update(id, {status: 'failed', error: message(error)});
  }
 }
}

export class AgentRuntime {
 readonly registry: AgentRegistry; readonly events = new AgentEventBus(); readonly queue: TaskQueue;
 readonly maxParallelSteps: number;
 constructor(readonly store: TaskStore, readonly provider: LLMProvider | null, options: {maxParallelSteps?: number; files?: FileStore; tools?: ToolRegistry} = {}) {
  this.maxParallelSteps = options.maxParallelSteps ?? 2;
  if (![1, 2].includes(this.maxParallelSteps)) throw new Error('maxParallelSteps must be 1 or 2');
  this.files = options.files;
  this.tools = options.tools ?? new ToolRegistry(this.files, provider);
  this.registry = new AgentRegistry(provider, this.tools);
  const state: State = (agentId, status, taskId) => this.events.publish(store.event({kind: 'agent', agentId, status, taskId, source: 'runtime'}));
  for (const task of store.interrupted()) {
   const error = '后端在执行期间重启，任务已中断；请手动重试。';
   const steps = task.steps?.map(s => s.status === 'running' ? {...s, status: 'failed' as const, error, toolCalls: s.toolCalls?.map(call => call.status === 'running' ? {...call,status:'failed' as const,error,completedAt:new Date().toISOString()} : call)} : ['pending', 'waiting'].includes(s.status) ? {...s, status: 'blocked' as const, error} : s);
   this.events.publish(store.event({kind: 'task', task: store.update(task.id, {status: 'failed', error, ...(steps ? {steps} : {})})}));
  }
  for (const a of agents) state(a.id, 'IDLE');
  const executor = provider ? new TaskExecutor(this.registry.agents.get('manager') as ManagerAgent, this.registry, new TaskRouter(), store, state, task => this.events.publish(store.event({kind: 'task', task})), this.maxParallelSteps) : null;
  this.queue = new TaskQueue(async id => {if (executor) await executor.execute(id);});
  if (provider) for (const task of store.pending()) this.queue.push(task.id);
 }
 readonly files?: FileStore;
 readonly tools: ToolRegistry;
 submit(input: string, parentId?: string, fileIds: string[] = [], allowWeb?: boolean) {
  if (!this.provider) throw new ProviderError('NOT_CONFIGURED', '请先配置模型服务商、模型和 API Secret。');
  if (parentId && !this.store.get(parentId)) throw new ProviderError('INVALID_PARENT', '原任务不存在。');
  if (this.queue.size >= 10) throw new ProviderError('QUEUE_FULL', '任务队列已满，请稍后提交。');
  const parent = parentId ? this.store.get(parentId) : undefined;
  const inherited = parent?.attachments ?? [];
  if (fileIds.length && !this.files) throw new ProviderError('FILES_NOT_CONFIGURED', '附件服务尚未配置。');
  const attachments = [...new Map([...inherited, ...fileIds.map(id => this.files!.get(id))].map(file => [file.id, file])).values()];
  if (attachments.length > 4) throw new ProviderError('FILE_LIMIT', '每个任务最多附加四个文件。');
  const task = this.store.create(input, parentId, attachments, allowWeb ?? parent?.allowWeb ?? false); this.events.publish(this.store.event({kind: 'task', task})); this.queue.push(task.id); return task;
 }
}
