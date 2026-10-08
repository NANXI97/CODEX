import {randomBytes,createHash,scryptSync,scrypt,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Request,Response} from 'express';

export interface AccessConfig {password:string;origin:string;database:string;secure:boolean;sessionMs?:number;now?:()=>number}
export function readAccessConfig(env:NodeJS.ProcessEnv=process.env):AccessConfig|null {
 const password=env.APP_PASSWORD??'';
 if(!password&&env.NODE_ENV!=='production')return null;
 if(password.length<16||password.length>256||password!==password.trim()||/[\r\n\0]/.test(password))throw new Error('APP_PASSWORD 必须是 16–256 字符的工作室登录密码，不能包含前后空格或换行。');
 const value=env.APP_ORIGIN||env.RENDER_EXTERNAL_URL;
 let url:URL;try{url=new URL(value??'');}catch{throw new Error('请配置工作室的 APP_ORIGIN；Render 会自动提供 RENDER_EXTERNAL_URL。');}
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(env.NODE_ENV==='production'?url.protocol!=='https:':url.protocol!=='https:'&&!(local&&url.protocol==='http:')))throw new Error('工作室地址必须是完整 HTTPS 来源网址，不包含路径、查询参数或凭据。');
 return {password,origin:url.origin,database:env.AUTH_DB_PATH??'.local/access.sqlite',secure:url.protocol==='https:'};
}
export function readListenConfig(env:NodeJS.ProcessEnv=process.env){
 const port=Number(env.PORT??env.API_PORT??3001);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT/API_PORT 必须是有效端口。');
 return {port,host:env.API_HOST??(env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1')};
}

// Only opaque, HttpOnly cookies leave the server. SQLite stores token hashes, never passwords or raw tokens.
export class OfficeAccess {
 private db:DatabaseSync;
 private salt:Buffer;
 private key:Buffer;
 private version:string;
 private attempts=new Map<string,{count:number;until:number}>();
 private listeners=new Map<string,Set<()=>void>>();
 readonly cookieName:string;
 readonly sessionMs:number;
 private now:()=>number;
 constructor(readonly config:AccessConfig){
  if(config.database!==':memory:')mkdirSync(dirname(config.database),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(config.database);
  this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS access_meta(name TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS access_sessions(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL,version TEXT NOT NULL);');
  let salt=this.db.prepare("SELECT value FROM access_meta WHERE name='salt'").get()?.value;
  if(!salt){salt=randomBytes(16).toString('hex');this.db.prepare('INSERT INTO access_meta VALUES (?,?)').run('salt',String(salt));}
  this.salt=Buffer.from(String(salt),'hex');this.key=scryptSync(config.password,this.salt,32);
  this.version=createHash('sha256').update(this.key).digest('hex');
  this.now=config.now??Date.now;this.sessionMs=config.sessionMs??8*60*60*1000;
  this.cookieName=config.secure?'__Host-xuejie_session':'xuejie_session';
  this.db.prepare('DELETE FROM access_sessions WHERE expires<=? OR version<>?').run(this.now(),this.version);
 }
 private hash(token:string){return createHash('sha256').update(token).digest('hex');}
 token(req:Request){
  const matches=(req.headers.cookie??'').split(';').map(p=>p.trim()).filter(p=>p.startsWith(this.cookieName+'='));
  if(matches.length!==1)return undefined;
  const token=matches[0].slice(this.cookieName.length+1);return /^[a-f0-9]{64}$/.test(token)?token:undefined;
 }
 valid(token:string|undefined){if(!token)return false;const row=this.db.prepare('SELECT expires,version FROM access_sessions WHERE token_hash=?').get(this.hash(token));return !!row&&Number(row.expires)>this.now()&&row.version===this.version;}
 authenticated(req:Request){return this.valid(this.token(req));}
 allowAttempt(ip:string){
  const now=this.now();for(const [key,value] of this.attempts)if(value.until<=now)this.attempts.delete(key);
  const window=this.attempts.get(ip);
  if(window){if(window.count>=5)return false;window.count++;return true;}
  if(this.attempts.size>=1000)return false;
  this.attempts.set(ip,{count:1,until:now+15*60*1000});return true;
 }
 async login(password:unknown,ip:string,res:Response){
  if(typeof password!=='string'||password.length>256)return false;
  const key=await new Promise<Buffer>((resolve,reject)=>scrypt(password,this.salt,32,(error,value)=>error?reject(error):resolve(value)));
  if(!timingSafeEqual(key,this.key))return false;
  this.attempts.delete(ip);
  const token=randomBytes(32).toString('hex'),expires=this.now()+this.sessionMs;
  this.db.prepare('DELETE FROM access_sessions WHERE expires<=?').run(this.now());
  // Bound retained sessions on a single-owner office.
  this.db.exec('DELETE FROM access_sessions WHERE token_hash IN (SELECT token_hash FROM access_sessions ORDER BY expires DESC LIMIT -1 OFFSET 99)');
  this.db.prepare('INSERT INTO access_sessions VALUES (?,?,?)').run(this.hash(token),expires,this.version);
  res.cookie(this.cookieName,token,{httpOnly:true,secure:this.config.secure,sameSite:'strict',path:'/',maxAge:this.sessionMs});
  return true;
 }
 logout(req:Request,res:Response){
  const token=this.token(req);if(token){const hash=this.hash(token);this.db.prepare('DELETE FROM access_sessions WHERE token_hash=?').run(hash);for(const close of this.listeners.get(hash)??[])close();this.listeners.delete(hash);}
  res.clearCookie(this.cookieName,{httpOnly:true,secure:this.config.secure,sameSite:'strict',path:'/'});
 }
 onRevoke(token:string,close:()=>void){const hash=this.hash(token),listeners=this.listeners.get(hash)??new Set<()=>void>();listeners.add(close);this.listeners.set(hash,listeners);return()=>{listeners.delete(close);if(!listeners.size)this.listeners.delete(hash);};}
 close(){for(const listeners of this.listeners.values())for(const close of listeners)close();this.listeners.clear();this.db.close();this.key.fill(0);}
}
