import {z} from 'zod';
import type {Calculation} from './types';
import {ProviderError} from './provider';
export type Expression =
 | {type: 'source'; sourceId: string; quote: string; value: string}
 | {type: 'constant'; value: '1' | '100'}
 | {type: 'result'; label: string}
 | {type: 'operation'; op: 'add' | 'subtract' | 'multiply' | 'divide'; left: Expression; right: Expression};
const expressionSchema: z.ZodType<Expression> = z.lazy(() => z.discriminatedUnion('type', [
 z.object({type: z.literal('source'), sourceId: z.string().min(1).max(40), quote: z.string().min(1).max(500), value: z.string().min(1).max(40)}).strict(),
 z.object({type: z.literal('constant'), value: z.enum(['1', '100'])}).strict(),
 z.object({type: z.literal('result'), label: z.string().min(1).max(100)}).strict(),
 z.object({type: z.literal('operation'), op: z.enum(['add', 'subtract', 'multiply', 'divide']), left: expressionSchema, right: expressionSchema}).strict(),
]));
export const calculationSchema = z.object({label: z.string().min(1).max(100), unit: z.string().max(30), expression: expressionSchema}).strict();
export type CalculationSpec = z.infer<typeof calculationSchema>;
type Rational = {n: bigint; d: bigint};
const invalid = (message: string): never => {throw new ProviderError('INVALID_CALCULATION', message);};
function gcd(a: bigint, b: bigint): bigint {a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a || 1n;}
function rational(n: bigint, d: bigint): Rational {
 if (!d) return invalid('计算遇到除数为零，请检查数据。');
 if (d < 0n) {n = -n; d = -d;}
 const g = gcd(n, d); return {n: n / g, d: d / g};
}
function parseNumber(value: string): Rational {
 const text = value.replace(/\s/g, '');
 if (!/^[+-]?(?:\d{1,15}|\d{1,3}(?:,\d{3}){1,4})(?:\.\d{1,6})?%?$/.test(text)) return invalid('数字格式不受支持，请提供普通十进制数字。');
 const percent = text.endsWith('%'), clean = text.replace(/,/g, '').replace(/%$/, ''), negative = clean.startsWith('-');
 const [whole, fraction = ''] = clean.replace(/^[+-]/, '').split('.');
 return rational(BigInt(whole + fraction) * (negative ? -1n : 1n), 10n ** BigInt(fraction.length) * (percent ? 100n : 1n));
}
function format(value: Rational): string {
 const scale = 1000000n, absolute = value.n < 0n ? -value.n : value.n;
 const rounded = (absolute * scale * 2n + value.d) / (value.d * 2n);
 const whole = rounded / scale, fraction = (rounded % scale).toString().padStart(6, '0').replace(/0+$/, '');
 return `${value.n < 0n && rounded ? '-' : ''}${whole}${fraction ? '.' + fraction : ''}`;
}
export function aggregateNumbers(values: string[], operation: 'sum' | 'average' | 'min' | 'max'): string {
 if (!values.length) return invalid('所选范围没有可计算的数字。');
 const numbers = values.map(parseNumber);
 const total = numbers.reduce((a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d), rational(0n, 1n));
 if (operation === 'sum') return format(total);
 if (operation === 'average') return format(rational(total.n, total.d * BigInt(numbers.length)));
 return format(numbers.reduce((a, b) => ((a.n * b.d < b.n * a.d) === (operation === 'min')) ? a : b));
}
// Bounded arithmetic, never eval or executable model-generated code.
// Business operands must be quoted from the user or a completed direct dependency.
export function calculate(specs: CalculationSpec[], sources: Record<string, string>): Calculation[] {
 const results = new Map<string, Rational>();
 return specs.map(spec => {
  if (results.has(spec.label)) return invalid('计算项目名称重复，无法确定引用关系。');
  let count = 0;
  function evaluate(e: Expression, depth = 0): {value: Rational; formula: string} {
   if (++count > 64 || depth > 12) return invalid('计算表达式过于复杂，请拆分任务。');
   if (e.type === 'constant') return {value: parseNumber(e.value), formula: e.value};
   if (e.type === 'result') {const value = results.get(e.label); if (!value) return invalid('计算引用了尚未完成的项目。'); return {value, formula: e.label};}
   if (e.type === 'source') {
    const source = sources[e.sourceId];
    if (!Object.hasOwn(sources, e.sourceId) || typeof source !== 'string' || !source.includes(e.quote)) return invalid('计算数字的来源无法核对，未返回计算结果。');
    const tokens = [...e.quote.matchAll(/(?<![\d.,])[+-]?\d+(?:,\d{3})*(?:\.\d+)?\s*%?(?![\d.,])/g)].map(m => m[0].replace(/\s/g, ''));
    if (!tokens.includes(e.value.replace(/\s/g, ''))) return invalid('计算引用的数字未完整出现在来源中。');
    return {value: parseNumber(e.value), formula: e.value};
   }
   const left = evaluate(e.left, depth + 1), right = evaluate(e.right, depth + 1), a = left.value, b = right.value;
   const value = e.op === 'add' ? rational(a.n * b.d + b.n * a.d, a.d * b.d)
    : e.op === 'subtract' ? rational(a.n * b.d - b.n * a.d, a.d * b.d)
    : e.op === 'multiply' ? rational(a.n * b.n, a.d * b.d)
    : rational(a.n * b.d, a.d * b.n);
   return {value, formula: `(${left.formula} ${ {add: '+', subtract: '−', multiply: '×', divide: '÷'}[e.op]} ${right.formula})`};
  }
  const result = evaluate(spec.expression); results.set(spec.label, result.value);
  return {label: spec.label, unit: spec.unit, value: format(result.value), formula: result.formula};
 });
}
