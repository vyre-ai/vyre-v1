// A preview has no replica, normal session callback, persistent storage or general capability caller.
import {createCapCaller,type CapCallerOptions} from './index.ts';
export interface RecordsPreviewTicket {token:string;expiresAt:number}
export interface RecordsPreviewReader {call(cap:'records.get'|'records.query',input:Record<string,unknown>):Promise<unknown>;close():void}
export function createRecordsPreview(o:RecordsPreviewTicket&Pick<CapCallerOptions,'baseUrl'|'fetch'|'routes'>&{now?:()=>number}):RecordsPreviewReader{
 const now=o.now??Date.now,controller=new AbortController();let bearer:string|null=o.token;
 if(!/^vas_[a-f0-9]{64}$/.test(bearer)||!Number.isFinite(o.expiresAt))throw new Error('Invalid shared record preview.');
 const check=()=>{if(!bearer||controller.signal.aborted||now()>=o.expiresAt)throw new Error('This shared record preview has ended.');};
 const transport=o.fetch??globalThis.fetch;
 const call=createCapCaller({baseUrl:o.baseUrl,token:()=>bearer,...(o.routes?{routes:o.routes}:{}),fetch:async(url,init)=>{check();const response=await transport(url,{...init,signal:controller.signal});check();return response;}});
 return {async call(cap,input){check();if(cap!=='records.get'&&cap!=='records.query')throw new Error('Only shared record reads are available in this preview.');
  const keys=cap==='records.get'?['type','recordId']:['type','limit','cursor'];
  if(!input||Object.keys(input).some(key=>!keys.includes(key)))throw new Error('This preview request has unsupported options.');
  if(typeof input['type']!=='string'||!input['type']||(cap==='records.get'&&typeof input['recordId']!=='string'))throw new Error('Choose a shared record type and record.');
  const result=await call(cap,input,{signal:controller.signal});check();return result;
 },close(){bearer=null;controller.abort();}};
}
