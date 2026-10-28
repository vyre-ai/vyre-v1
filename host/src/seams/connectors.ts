// Per-execution connector ports. Vault values arrive only through authorized canonical fill.
import dns from 'node:dns/promises';
import http from 'node:http';import https from 'node:https';import net from 'node:net';
import {blockedAddress} from './vault.ts';import {fail} from '../routes/errors.ts';
export interface ConnectorCaller {space:string;principal:{kind:string;id:string};actingFor?:string;trace:{traceId:string;spanId:string};depth:number;rememberVaultItem?(id:string):void;assertAuthorized?():void;call(cap:'vault.fill',input:unknown):Promise<unknown>}
export interface SecretBinding {connector:string;connectionId:string;slot:string;handle:string}
export interface FillExecution {space:string;principal:{kind:string;id:string};actingFor?:string;traceId:string;parentSpanId?:string;depth:number}
interface Filled {value:string;ref:string;handle:string;field:string;itemId:string}
export interface ConnectorRequest { (url:URL, options:{ips:readonly string[];method:string;headers:Record<string,string>;body?:string}):Promise<{status:number;location?:string;text:string}> }
export interface ConnectorNetwork {resolve?:(host:string)=>Promise<string[]>;request?:ConnectorRequest}
const request:ConnectorRequest=(url,o)=>new Promise((resolve,reject)=>{
 const req=https.request({hostname:url.hostname,port:url.port||443,path:`${url.pathname}${url.search}`,method:o.method,headers:{...o.headers,host:url.host},servername:net.isIP(url.hostname)?undefined:url.hostname,lookup:(_host:string,opts:{all?:boolean},cb:(err:Error|null,a:unknown,f?:number)=>void)=>{const rows=o.ips.map(address=>({address,family:net.isIPv6(address)?6:4}));if(opts?.all)cb(null,rows);else cb(null,rows[0]!.address,rows[0]!.family);},timeout:15000} as http.RequestOptions,res=>{const chunks:Buffer[]=[];let size=0;res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>5*1024*1024){req.destroy(new Error('response too large'));return;}chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode??0,...(res.headers.location?{location:res.headers.location}:{}),text:Buffer.concat(chunks).toString('utf8')}));});req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);req.end(o.body);
});
const allowed=(host:string,domains:readonly string[])=>domains.some(domain=>domain.startsWith('*.')?host.endsWith(domain.slice(1))&&host.length>domain.length-1:host===domain);
export function createConnectorsHost(o:{publicBase():string;own(caller:ConnectorCaller):boolean;network?:ConnectorNetwork}){
 const pending=new Map<string,{caller:ConnectorCaller;binding:SecretBinding;used:boolean;value?:string}>();
 return{
  accepts:(ref:string)=>pending.has(ref),
  sink:(filled:Filled,execution?:FillExecution)=>{
   const entry=pending.get(filled.ref);if(!entry||entry.used||!execution)throw new Error('Connector fill reference is unavailable.');const c=entry.caller;
   const [base,field]=entry.binding.handle.split('.');
   if(execution.space!==c.space||execution.principal.kind!==c.principal.kind||execution.principal.id!==c.principal.id||execution.actingFor!==c.actingFor||execution.traceId!==c.trace.traceId||execution.parentSpanId!==c.trace.spanId||execution.depth!==c.depth+1||filled.handle.toLowerCase()!==base!.toLowerCase()||(field!==undefined&&filled.field!==field))throw new Error('Connector fill context does not match.');
   entry.used=true;entry.value=filled.value;entry.caller.rememberVaultItem?.(filled.itemId);
  },
  publicBase:()=>{const value=new URL(o.publicBase());if(!['http:','https:'].includes(value.protocol)||value.username||value.password)throw new Error('The configured Space address is invalid.');return value.origin;},
  async fill(caller:ConnectorCaller,binding:SecretBinding):Promise<string>{
   if(pending.size>=128)throw fail('provider.rate_limited',caller.trace.traceId);const ref=`connector:${globalThis.crypto.randomUUID()}`;const entry={caller,binding,used:false} as {caller:ConnectorCaller;binding:SecretBinding;used:boolean;value?:string};pending.set(ref,entry);let timer:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([caller.call('vault.fill',{handle:binding.handle,target:{kind:'http_header',ref}}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Connector fill timed out.')),30000);timer.unref();})]);if(!entry.used||entry.value===undefined)throw new Error('The Vault did not fill this connector.');return entry.value;}finally{if(timer)clearTimeout(timer);pending.delete(ref);delete entry.value;}
  },
  async http(caller:ConnectorCaller,domains:readonly string[],raw:string,init?:{method?:string;headers?:Record<string,string>;body?:string}){
   let url:URL;try{url=new URL(raw);}catch{throw fail('validation.bad_input',caller.trace.traceId);}const origin=url.origin;let method=init?.method??'GET',body=init?.body;const headers={...init?.headers};
   if(body&&Buffer.byteLength(body)>5*1024*1024)throw fail('validation.too_large',caller.trace.traceId);
   for(let hop=0;hop<5;hop++){
    if(url.protocol!=='https:'||url.username||url.password||!allowed(url.hostname.toLowerCase(),domains.map(domain=>domain.toLowerCase()))||url.origin!==origin)throw fail('permission.no_grant',caller.trace.traceId,{message:'This connector may not reach that address.'});
    let ips:string[];try{ips=await(o.network?.resolve??(async(host:string)=>(await dns.lookup(host,{all:true})).map(row=>row.address)))(url.hostname);}catch{throw fail('provider.network',caller.trace.traceId,{message:'The connector address could not be resolved.'});}
    if(!ips.length||ips.some(ip=>blockedAddress(ip,o.own(caller))!==null))throw fail('permission.no_grant',caller.trace.traceId,{message:'This connector may not reach that network address.'});
    caller.assertAuthorized?.();
    let result;try{result=await(o.network?.request??request)(url,{ips,method,headers,...(body!==undefined?{body}:{})});}catch{throw fail('provider.network',caller.trace.traceId,{message:'The connector request failed.'});}
    if(Buffer.byteLength(result.text)>5*1024*1024)throw fail('provider.bad_response',caller.trace.traceId,{message:'The connector response is too large.'});
    if(result.status>=300&&result.status<400&&result.location){try{url=new URL(result.location,url);}catch{throw fail('provider.bad_response',caller.trace.traceId,{message:'The connector returned an invalid redirect.'});}if(result.status===303||([301,302].includes(result.status)&&method==='POST')){method='GET';body=undefined;}continue;}
    return{status:result.status,text:async()=>result.text};
   }throw fail('provider.bad_response',caller.trace.traceId,{message:'The connector returned too many redirects.'});
  },
 };
}
