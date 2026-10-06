import {fetch,EnvHttpProxyAgent,type Dispatcher} from 'undici';
import type {LLMProvider,LLMRequest} from './types';
export class ProviderError extends Error {
 constructor(public code:string,message:string){super(message);}
}
export interface ProviderConfig {baseUrl:string;model:string;apiKey:string;maxTokens:number;timeoutMs:number}
export function readProviderConfig():ProviderConfig|null {
 if(!process.env.LLM_API_KEY)return null;
 if((process.env.LLM_PROVIDER??'openai-responses')!=='openai-responses')throw new Error('Unsupported LLM_PROVIDER; use openai-responses');
 const base=new URL(process.env.LLM_BASE_URL??'https://api.openai.com/v1');if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new Error('LLM_BASE_URL must be a clean HTTPS URL');
 const maxTokens=Number(process.env.LLM_MAX_TOKENS??4096),timeoutMs=Number(process.env.LLM_TIMEOUT_MS??60000);
 if(!Number.isInteger(maxTokens)||maxTokens<64||maxTokens>16384||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw new Error('Invalid LLM limits');
 return {baseUrl:base.href.replace(/\/$/,''),model:process.env.LLM_MODEL??'gpt-6-luna',apiKey:process.env.LLM_API_KEY,maxTokens,timeoutMs};
}
// Adapter boundary: runtime never depends on HTTP format or a particular vendor.
export class OpenAIResponsesProvider implements LLMProvider {
 constructor(private config:ProviderConfig,private dispatcher:Dispatcher=new EnvHttpProxyAgent()){}
 async complete(request:LLMRequest):Promise<string>{
  const signal=AbortSignal.timeout(this.config.timeoutMs);
  for(let attempt=0;attempt<2;attempt++){
   let response;
   try {response=await fetch(`${this.config.baseUrl}/responses`,{dispatcher:this.dispatcher,method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${this.config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:this.config.model,store:false,input:[{role:'system',content:request.system},{role:'user',content:request.user}],max_output_tokens:this.config.maxTokens,...(request.json?{text:{format:{type:'json_object'}}}:{})})});}
   catch {throw new ProviderError(signal.aborted?'TIMEOUT':'NETWORK',signal.aborted?'模型调用超时，请重试。':'模型服务连接失败，请检查网络配置。');}
   if(!response.ok){const status=response.status;await response.body?.cancel();if(attempt===0&&(status===429||status>=500))continue;throw new ProviderError(`HTTP_${status}`,status===401||status===403?'模型服务拒绝认证，请检查 Secret 和权限。':`模型服务返回 HTTP ${status}。`);}
   let payload:unknown;try{payload=await response.json();}catch{throw new ProviderError('INVALID_RESPONSE','模型服务返回了无法解析的响应。');}
   const result=payload as {status?:string;output?:{type:string;content?:{type:string;text?:string}[]}[]};
   if(result.status==='incomplete')throw new ProviderError('TRUNCATED','模型响应未完整完成，请缩短原文或调整输出上限。');
   if(result.status!=='completed')throw new ProviderError('INVALID_RESPONSE','模型响应未完成，任务未返回成功结果。');
   const content=result.output?.filter(item=>item.type==='message').flatMap(item=>item.content??[]).filter(item=>item.type==='output_text').map(item=>item.text??'').join('\n').trim();
   if(!content)throw new ProviderError('EMPTY_RESPONSE','模型未返回有效文本。');return content;

  }
  throw new ProviderError('FAILED','模型调用失败。');
 }
}
