import {randomUUID, createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync} from 'node:fs';
import {extname, join} from 'node:path';
import {z} from 'zod';
import {parse} from 'csv-parse/sync';
import readXlsxFile from 'read-excel-file/node';
import {unzipSync, strFromU8} from 'fflate';
import {ProviderError} from './provider';
import {aggregateNumbers} from './calculation';
import type {FileAttachment} from './types';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CELLS = 50000, MAX_ROWS = 10000, MAX_COLUMNS = 100;
type Cell = string | number | boolean | null;
export interface Sheet {name: string; rows: Cell[][]}
const fail = (message: string): never => {throw new ProviderError('INVALID_FILE', message);};
const attachmentSchema = z.object({id: z.string().uuid(), name: z.string(), format: z.enum(['txt', 'md', 'csv', 'xlsx']), size: z.number(), sha256: z.string().regex(/^[a-f0-9]{64}$/)});
function text(bytes: Buffer) {
 try {const value = new TextDecoder('utf-8', {fatal: true}).decode(bytes); if (value.includes('\0')) return fail('文件必须是 UTF-8 文本。'); return value;} catch {return fail('文件必须是 UTF-8 文本。');}
}
function bound(sheets: Sheet[]) {
 if (!sheets.length || sheets.length > 8) return fail('工作簿必须包含 1–8 个工作表。');
 let cells = 0;
 for (const sheet of sheets) {
  if (sheet.rows.length > MAX_ROWS || sheet.rows.some(row => row.length > MAX_COLUMNS)) return fail('表格超过 10000 行或 100 列限制。');
  cells += sheet.rows.reduce((n, row) => n + row.length, 0);
 }
 if (cells > MAX_CELLS) return fail('表格超过 50000 个单元格限制，请拆分上传。');
 return sheets;
}
export async function parseSheets(bytes: Buffer, format: 'csv' | 'xlsx'): Promise<Sheet[]> {
 if (format === 'csv') {
  try {return bound([{name: 'CSV', rows: parse(text(bytes), {bom: true, skip_empty_lines: true, relax_column_count: false, max_record_size: 50000}) as string[][]}]);}
  catch (e) {if (e instanceof ProviderError) throw e; return fail('CSV 格式无效，请使用 UTF-8、逗号分隔和一致的列数。');}
 }
 try {
  let total = 0, entries = 0;
  const zip = unzipSync(bytes, {filter: entry => {
   total += entry.originalSize; entries++;
   if (total > 20 * 1024 * 1024 || entries > 1000) return fail('XLSX 解压大小超过限制。');
   return /^xl\/worksheets\/[^/]+\.xml$/.test(entry.name);
  }});
  // Read-only values: do not execute macros, links, or trust potentially stale formula caches.
  let cells=0;
  const coordinate=(ref:string)=>{
   const match=/^([A-Z]{1,3})([1-9]\d*)$/.exec(ref);
   if(!match)return fail('工作表坐标格式无效。');
   const col=[...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
   if(Number(match[2])>MAX_ROWS||col>MAX_COLUMNS)return fail('表格超过行列或单元格限制。');
  };
  for (const data of Object.values(zip)) {
   const xml=strFromU8(data);
   if (/<(?:\w+:)?f(?:\s|\/?\>)/.test(xml)) return fail('暂不接收含公式的 XLSX；请将公式转成数值后上传，或导出 CSV。');
   for (const match of xml.matchAll(/<(?:\w+:)?dimension\s[^>]*\bref\s*=\s*["']([^"']+)["']/g)) for(const ref of match[1].split(':'))coordinate(ref);
   for (const match of xml.matchAll(/<(?:\w+:)?c\s[^>]*\br\s*=\s*["']([^"']+)["']/g)) {
    if(++cells>MAX_CELLS)return fail('表格超过行列或单元格限制。');coordinate(match[1]);
   }
  }
  const sheets=await readXlsxFile(bytes,{parseNumber: value=>value});
  return bound(sheets.map(sheet=>({name:sheet.sheet,rows:sheet.data.map(row=>row.map(value=>value instanceof Date?value.toISOString():value as Cell))})));
 } catch (e) {if (e instanceof ProviderError) throw e; return fail('XLSX 文件无效、受密码保护或格式不受支持。');}
}

export class FileStore {
 constructor(readonly directory: string) {mkdirSync(directory, {recursive: true, mode: 0o700});}
 async upload(name: string, bytes: Buffer): Promise<FileAttachment> {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) return fail('文件须为非空且不超过 5 MB。');
  if (!name || name.length > 160 || /[\/\\\x00-\x1f]/.test(name) || name === '.' || name === '..') return fail('文件名无效。');
  const format = extname(name).slice(1).toLowerCase();
  if (!['txt', 'md', 'csv', 'xlsx'].includes(format)) return fail('支持 TXT、Markdown、CSV 和 XLSX；暂不支持 PDF、图片或 XLS。');
  if (this.list().reduce((n, file) => n + file.size, 0) + bytes.length > 100 * 1024 * 1024 || this.list().length >= 100) return fail('本地附件存储已达上限（100 MB／100 文件）。');
  if (format === 'csv' || format === 'xlsx') await parseSheets(bytes, format); else text(bytes);
  const file: FileAttachment = {id: randomUUID(), name, format: format as FileAttachment['format'], size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  const path = join(this.directory, file.id);
  try {writeFileSync(path + '.bin', bytes, {mode: 0o600, flag: 'wx'}); writeFileSync(path + '.json', JSON.stringify(file), {mode: 0o600, flag: 'wx'});}
  catch {try {unlinkSync(path + '.bin');} catch {} return fail('附件保存失败。');}
  return file;
 }
 list(): FileAttachment[] {
  return readdirSync(this.directory).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => attachmentSchema.parse(JSON.parse(readFileSync(join(this.directory, name), 'utf8'))));
 }
 get(id: string): FileAttachment {
  if (!z.string().uuid().safeParse(id).success) return fail('附件标识无效。');
  try {return attachmentSchema.parse(JSON.parse(readFileSync(join(this.directory, id + '.json'), 'utf8')));} catch {return fail('附件不存在。');}
 }
 bytes(file: FileAttachment) {
  const bytes = readFileSync(join(this.directory, file.id + '.bin'));
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) return fail('附件完整性检查失败。');
  return bytes;
 }
 readText(file: FileAttachment, offset: number, length: number) {
  if (!['txt', 'md'].includes(file.format)) return fail('表格请使用 spreadsheet 工具。');
  const content = text(this.bytes(file));
  return {fileId: file.id, name: file.name, sha256: file.sha256, offset, text: content.slice(offset, offset + length), totalCharacters: content.length, hasMore: offset + length < content.length};
 }
 async sheets(file: FileAttachment) {
  if (file.format !== 'csv' && file.format !== 'xlsx') return fail('该附件不是 CSV 或 XLSX。');
  return parseSheets(this.bytes(file), file.format);
 }
}

export const rangeSchema = z.object({sheet: z.string().min(1).max(100), startRow: z.number().int().min(1).max(MAX_ROWS), endRow: z.number().int().min(1).max(MAX_ROWS), startColumn: z.number().int().min(1).max(MAX_COLUMNS), endColumn: z.number().int().min(1).max(MAX_COLUMNS)});
export function selectRange(sheets: Sheet[], range: z.infer<typeof rangeSchema>) {
 const sheet = sheets.find(sheet => sheet.name === range.sheet);
 if (!sheet || range.startRow > range.endRow || range.startColumn > range.endColumn || range.endRow > sheet.rows.length || range.endColumn > Math.max(0, ...sheet.rows.map(row => row.length))) return fail('工作表或单元格范围不存在；行列均从 1 开始。');
 return sheet.rows.slice(range.startRow - 1, range.endRow).map(row => Array.from({length: range.endColumn - range.startColumn + 1}, (_, i) => row[range.startColumn - 1 + i] ?? null));
}
export function aggregateRange(rows: Cell[][], operation: 'sum' | 'average' | 'min' | 'max' | 'count') {
 const cells = rows.flat().filter(value => value !== null && String(value).trim() !== '');
 if (operation === 'count') return {value: String(cells.length), nonEmptyCells: cells.length, blankCells: rows.flat().length - cells.length};
 if (cells.some(value => typeof value === 'boolean' || !/^[+-]?(?:\d{1,15}|\d{1,3}(?:,\d{3}){1,4})(?:\.\d{1,6})?%?$/.test(String(value).trim()))) return fail('计算范围包含非数字或不支持的数值，请排除表头并核对格式。');
 return {value: aggregateNumbers(cells.map(value => String(value).trim()), operation), nonEmptyCells: cells.length, blankCells: rows.flat().length - cells.length};
}
