import {DatabaseSync} from 'node:sqlite';
import {mkdirSync}from'node:fs';
import {dirname}from'node:path';
import {randomUUID}from'node:crypto';
import type {Task,TaskStatus,RuntimeEvent}from'./types';
import {agents,type AgentStatus}from'../src/runtime/model';
export class TaskStore {
 private db:DatabaseSync;
 constructor(path:string){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL);');}
 create(input:string,parentId?:string){const now=new Date().toISOString();const task:Task={id:randomUUID(),input,status:'queued',createdAt:now,updatedAt:now,...(parentId?{parentId}:{})};this.db.prepare('INSERT INTO tasks VALUES (?,?)').run(task.id,JSON.stringify(task));return task;}
 get(id:string):Task|undefined{const row=this.db.prepare('SELECT payload FROM tasks WHERE id=?').get(id);return row?JSON.parse(String(row.payload)):undefined;}
 list():Task[]{return this.db.prepare('SELECT payload FROM tasks ORDER BY rowid DESC LIMIT 100').all().map(r=>JSON.parse(String(r.payload)));}
 pending():Task[]{return this.db.prepare('SELECT payload FROM tasks ORDER BY rowid').all().map(r=>JSON.parse(String(r.payload))).filter(t=>t.status==='queued');}
 update(id:string,change:Partial<Omit<Task,'id'|'input'|'createdAt'>>):Task{const current=this.get(id);if(!current)throw new Error('Task not found');const task={...current,...change,updatedAt:new Date().toISOString()};this.db.prepare('UPDATE tasks SET payload=? WHERE id=?').run(JSON.stringify(task),id);return task;}
 event(input:Omit<Extract<RuntimeEvent,{kind:'agent'}>,'sequence'|'timestamp'>|Omit<Extract<RuntimeEvent,{kind:'task'}>,'sequence'|'timestamp'>):RuntimeEvent{const payload={...input,timestamp:new Date().toISOString()};const result=this.db.prepare('INSERT INTO events(payload) VALUES (?)').run(JSON.stringify(payload));return {...payload,sequence:Number(result.lastInsertRowid)} as RuntimeEvent;}
 eventsSince(sequence:number):RuntimeEvent[]{return this.db.prepare('SELECT sequence,payload FROM events WHERE sequence>? ORDER BY sequence').all(sequence).map(r=>({...JSON.parse(String(r.payload)),sequence:Number(r.sequence)}));}
 snapshot(){const states=agents.map(a=>({agentId:a.id,status:'IDLE' as AgentStatus,sequence:0,source:'runtime' as const,timestamp:new Date().toISOString()}));for(const e of this.eventsSince(0))if(e.kind==='agent'){const index=states.findIndex(s=>s.agentId===e.agentId);states[index]=e;}return {agents:states,tasks:this.list(),sequence:Number(this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events').get()!.n)};}
 interrupted():Task[]{const rows=this.db.prepare('SELECT payload FROM tasks').all().map(r=>JSON.parse(String(r.payload)) as Task);return rows.filter(t=>t.status==='running');}
 close(){this.db.close();}
}
