import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentRuntime} from './runtime';
import {TaskStore} from './store';
import {ProviderError, readProviderConfig} from './provider';
import {calculate, type Expression} from './calculation';
import type {AgentContext, ExecutionPlan, LLMProvider, LLMRequest, StepDefinition} from './types';
const result = (output: string) => JSON.stringify({status: 'completed', output, question: ''});
const definition = (id: string, agentId: StepDefinition['agentId'], dependsOn: string[] = []): StepDefinition => ({id, agentId, dependsOn, instruction: id});
const plan = (steps: StepDefinition[]): ExecutionPlan => ({action: 'execute', steps, question: '', scopeNote: ''});
const source = (value: string, quote: string, sourceId = 'user'): Expression => ({type: 'source', value, quote, sourceId});
const profit = {label: '月利润', unit: '韩元', expression: {type: 'operation' as const, op: 'subtract' as const, left: source('33,000', '收入33,000韩元'), right: source('22,000', '成本22,000韩元')}};
async function settle(runtime: AgentRuntime) {for (let i = 0; i < 200; i++) {await new Promise<void>(r => setImmediate(r)); if (!runtime.queue.busy) return;} throw new Error('Runtime did not finish');}
async function until(check: () => boolean) {for (let i = 0; i < 100; i++) {if (check()) return; await new Promise<void>(r => setImmediate(r));} throw new Error('Condition did not occur');}
// All deterministic substitutes below are confined to tests; real acceptance uses OpenAI.
test('four dependent agents receive only completed dependencies; arithmetic is executed by backend', async () => {
 const store = new TaskStore(':memory:'), calls: string[] = [];
 const steps = [definition('translate', 'translator'), definition('policy', 'policy', ['translate']), definition('data', 'data', ['policy']), definition('copy', 'design', ['data'])];
 const provider: LLMProvider = {async complete(request) {
  if (request.system.startsWith('你是学姐通信的总控')) {calls.push('plan'); return JSON.stringify(plan(steps));}
  if (!request.json) {calls.push('summary'); const payload = JSON.parse(request.user); assert.ok(payload.steps.every((s: {output: string}) => s.output)); return '团队真实执行结果的测试汇总';}
  const context: AgentContext = JSON.parse(request.user); calls.push(context.instruction);
  if (context.instruction === 'translate') {assert.deepEqual(context.dependencies, {}); return result('每月33,000韩元，24个月，仅新客户。');}
  if (context.instruction === 'policy') {assert.deepEqual(Object.keys(context.dependencies), ['translate']); return result('月费33,000韩元，合约24个月，仅新客户。');}
  if (context.instruction === 'data') {assert.deepEqual(Object.keys(context.dependencies), ['policy']); return JSON.stringify({status: 'completed', output: '按同币种月度收入减成本计算。', question: '', calculations: [profit]});}
  assert.equal(context.instruction, 'copy'); assert.deepEqual(Object.keys(context.dependencies), ['data']); assert.equal(context.dependencies.data.calculations?.[0].value, '11000'); return result('月费33,000韩元，合约24个月，仅新客户。欢迎咨询。');
 }};
 const runtime = new AgentRuntime(store, provider), task = runtime.submit('翻译政策、算利润、写朋友圈：收入33,000韩元，成本22,000韩元。');
 await settle(runtime); assert.deepEqual(calls, ['plan', 'translate', 'policy', 'data', 'copy', 'summary']);
 const saved = store.get(task.id)!; assert.equal(saved.status, 'completed'); assert.equal(saved.steps?.[2].calculations?.[0].value, '11000'); assert.ok(saved.translation?.includes('33,000'));
 assert.ok(store.snapshot().agents.every(a => a.status === 'IDLE')); store.close();
});
test('ready steps run at most two at once and one request per agent; a third waits', async () => {
 const store = new TaskStore(':memory:'); const pending = new Map<string, (text: string) => void>();
 let active = 0, peak = 0; const starts: string[] = [], roleActive = new Set<string>();
 const steps = [definition('a', 'translator'), definition('b', 'translator'), definition('c', 'design'), definition('d', 'customer')];
 const provider: LLMProvider = {async complete(request) {
  if (request.system.startsWith('你是学姐通信的总控')) return JSON.stringify(plan(steps));
  if (!request.json) return '完成';
  const {instruction}: AgentContext = JSON.parse(request.user), role = steps.find(s => s.id === instruction)!.agentId;
  assert.ok(!roleActive.has(role)); roleActive.add(role); active++; peak = Math.max(peak, active); starts.push(instruction);
  const value = await new Promise<string>(resolve => pending.set(instruction, resolve)); active--; roleActive.delete(role); return value;
 }};
 const runtime = new AgentRuntime(store, provider); const task = runtime.submit('独立任务');
 await until(() => starts.length === 2); assert.deepEqual(starts, ['a', 'c']);
 pending.get('a')!(result('a')); await until(() => starts.length === 3); assert.deepEqual(starts, ['a', 'c', 'b']);
 pending.get('b')!(result('b')); await until(() => starts.length === 4); pending.get('c')!(result('c')); pending.get('d')!(result('d'));
 await settle(runtime); assert.equal(peak, 2); assert.equal(store.get(task.id)?.status, 'completed'); store.close();
});
test('cycles, missing dependencies and duplicate IDs fail before any specialist starts', async () => {
 for (const steps of [[definition('a', 'policy', ['b']), definition('b', 'data', ['a'])], [definition('a', 'policy', ['missing'])], [definition('a', 'policy'), definition('a', 'design')]]) {
  const store = new TaskStore(':memory:'); let calls = 0;
  const runtime = new AgentRuntime(store, {async complete() {calls++; return JSON.stringify(plan(steps));}});
  const task = runtime.submit('错误依赖'); await settle(runtime); assert.equal(calls, 1); assert.equal(store.get(task.id)?.status, 'failed'); assert.ok(!store.eventsSince(0).some(e => e.kind === 'agent' && e.agentId !== 'manager' && e.status === 'WORKING')); store.close();
 }
});
test('failure blocks descendants and unscheduled steps while genuine in-flight work finishes', async () => {
 const store = new TaskStore(':memory:'); let finishDesign: (text: string) => void = () => {}; const starts: string[] = [];
 const steps = [definition('a', 'translator'), definition('b', 'design'), definition('c', 'policy', ['a']), definition('d', 'customer')];
 const provider: LLMProvider = {async complete(request) {
  if (request.system.startsWith('你是学姐通信的总控')) return JSON.stringify(plan(steps));
  const {instruction}: AgentContext = JSON.parse(request.user); starts.push(instruction);
  if (instruction === 'a') throw new ProviderError('HTTP_500', '真实接口错误的测试分支');
  return new Promise(resolve => {finishDesign = resolve;});
 }};
 const runtime = new AgentRuntime(store, provider), task = runtime.submit('失败传播');
 await until(() => starts.length === 2); assert.equal(store.snapshot().agents.find(a => a.agentId === 'design')?.status, 'WORKING');
 finishDesign(result('独立步骤确实完成')); await settle(runtime);
 assert.deepEqual(starts, ['a', 'b']); const saved = store.get(task.id)!; assert.equal(saved.status, 'failed'); assert.deepEqual(saved.steps?.map(s => s.status), ['failed', 'completed', 'blocked', 'blocked']); assert.equal(saved.result, undefined); store.close();
});
test('clarification follow-up includes original request and new cost, without guessing data', async () => {
 const store = new TaskStore(':memory:'); let planning = 0;
 const provider: LLMProvider = {async complete(request) {
  if (request.system.startsWith('你是学姐通信的总控')) {
   planning++; if (planning === 1) return JSON.stringify({action: 'clarify', steps: [], question: '请提供月成本。', scopeNote: ''});
   assert.ok(request.user.includes('收入33,000韩元')); assert.ok(request.user.includes('成本22,000韩元')); return JSON.stringify(plan([definition('data', 'data')]));
  }
  if (!request.json) return '月利润11000韩元';
  return JSON.stringify({status: 'completed', output: '同币种月度口径。', question: '', calculations: [profit]});
 }};
 const runtime = new AgentRuntime(store, provider), original = runtime.submit('计算月利润，收入33,000韩元。'); await settle(runtime); assert.equal(store.get(original.id)?.status, 'needs_input');
 const follow = runtime.submit('成本22,000韩元。', original.id); await settle(runtime); assert.equal(store.get(follow.id)?.status, 'completed'); assert.equal(store.get(follow.id)?.steps?.[0].calculations?.[0].value, '11000'); store.close();
});
test('specialist clarification keeps completed work and blocks downstream instead of pretending success', async () => {
 const store = new TaskStore(':memory:'); let calls = 0;
 const responses = [JSON.stringify(plan([definition('a', 'translator'), definition('b', 'data', ['a']), definition('c', 'design', ['b'])])), result('译文'), JSON.stringify({status: 'needs_input', output: '', question: '成本是多少？', calculations: []})];
 const runtime = new AgentRuntime(store, {async complete() {calls++; return responses.shift()!;}}); const task = runtime.submit('缺少成本'); await settle(runtime);
 assert.equal(calls, 3); const saved = store.get(task.id)!; assert.equal(saved.status, 'needs_input'); assert.equal(saved.translation, '译文'); assert.deepEqual(saved.steps?.map(s => s.status), ['completed', 'needs_input', 'blocked']); assert.equal(store.snapshot().agents.find(a => a.agentId === 'data')?.status, 'WAITING'); store.close();
});
test('exact decimal/percentage arithmetic rejects invented or partial source values and zero division', () => {
 const add: Expression = {type: 'operation', op: 'add', left: source('0.1', 'A=0.1'), right: source('0.2', 'B=0.2')};
 assert.equal(calculate([{label: '合计', unit: '', expression: add}], {user: 'A=0.1 B=0.2'})[0].value, '0.3');
 const discount: Expression = {type: 'operation', op: 'multiply', left: source('10,000', '收入10,000'), right: source('10%', '费率10%')};
 assert.equal(calculate([{label: '费用', unit: '', expression: discount}], {user: '收入10,000 费率10%'})[0].value, '1000');
 for (const expression of [source('5,000', '收入15,000'), source('7', '不存在'), source('1', 'A=1', 'constructor'), {type: 'operation', op: 'divide', left: source('1', 'A=1'), right: source('0', 'B=0')} as Expression]) assert.throws(() => calculate([{label: '错误', unit: '', expression}], {user: '收入15,000 A=1 B=0'}), ProviderError);
});
test('restart preserves completed step outputs but fails running steps and blocks remaining work', () => {
 const store = new TaskStore(':memory:'), task = store.create('中断任务');
 store.update(task.id, {status: 'running', steps: [{...definition('a', 'translator'), status: 'completed', output: '已完成译文'}, {...definition('b', 'data', ['a']), status: 'running'}, {...definition('c', 'design', ['b']), status: 'waiting'}]});
 new AgentRuntime(store, null); const saved = store.get(task.id)!; assert.equal(saved.status, 'failed'); assert.deepEqual(saved.steps?.map(s => s.status), ['completed', 'failed', 'blocked']); assert.equal(saved.steps?.[0].output, '已完成译文'); store.close();
});
test('invalid timeout configuration falls back to 60 seconds without weakening token limits', () => {
 const names = ['LLM_API_KEY', 'LLM_PROVIDER', 'LLM_BASE_URL', 'LLM_MAX_TOKENS', 'LLM_TIMEOUT_MS']; const previous = Object.fromEntries(names.map(k => [k, process.env[k]]));
 try {process.env.LLM_API_KEY = 'test-placeholder'; process.env.LLM_PROVIDER = 'openai-responses'; process.env.LLM_BASE_URL = 'https://api.openai.com/v1'; process.env.LLM_MAX_TOKENS = '4096'; process.env.LLM_TIMEOUT_MS = 'invalid'; assert.equal(readProviderConfig()?.timeoutMs, 60000); process.env.LLM_MAX_TOKENS = 'bad'; assert.throws(() => readProviderConfig());}
 finally {for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];}
});
