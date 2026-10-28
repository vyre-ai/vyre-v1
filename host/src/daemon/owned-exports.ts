// Private, expiring admin artifacts. No caller can select a destination or an owner.
import type { AdminLogEntry, SupportExportContent } from "../../../lib/admin-export.ts";
import { sanitizeImportedText } from "../../../lib/import-text.ts";
import { mintUuid } from '../../../lib/ids.ts';
import type { Ctx } from '../../../packages/contracts/src/ctx.ts';
import type { BlobStore } from '../ctx/blobs.ts';
import type { RawDb } from '../ctx/db.ts';
import { fail } from '../routes/errors.ts';
export const EXPORT_TTL_MS=24*60*60*1000, EXPORT_MAX_BYTES=8*1024*1024;
const SOURCES={ 'logs.export':{permission:'server.logs',name:'server-logs',mime:'application/x-ndjson'}, 'health.support_bundle':{permission:'server.logs',name:'support-bundle',mime:'application/json'}, 'audit.export':{permission:'audit.read',name:'audit',mime:'text/csv'} } as const;
type Source=keyof typeof SOURCES;
interface Execution { space:string; principal:Ctx['principal']; actingFor?:string; trace:Ctx['trace']; authorize:Ctx['authorize'] }
interface Row {id:string;space:string;owner_kind:string;owner_id:string;actor_kind:string;actor_id:string;on_behalf:string|null;source:Source;blob_id:string;name:string;mime:string;size:number;at:number;expires_at:number}
const LOG_KEYS=new Set(['at','level','msg','id','traceId','spanId','actor','onBehalf','runId','place','cap','entity','entityId','result','durMs','costMicros','label','attrs']);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const secretKey=/authorization|cookie|password|secret|credential|private.?key|access.?token|api.?key|(^|_)(body|content|prompt|environment|system|developer)(_|$)/i;
export function scrubExport(value:unknown,depth=0):unknown {
 if(depth>12)return '[omitted]';
 if(typeof value==='string')return sanitizeImportedText(value);
 if(Array.isArray(value))return value.slice(0,10000).map((item)=>scrubExport(item,depth+1));
 if(object(value))return Object.fromEntries(Object.entries(value).slice(0,200).flatMap(([key,item])=>secretKey.test(key)?[]:[[key,scrubExport(item,depth+1)]]));
 return value===null||typeof value==='number'||typeof value==='boolean'?value:null;
}
export function createOwnedExports(options:{db:RawDb;blobs:BlobStore;space:string;now():number;register(resource:{id:string;ownerId:string},execution:Execution):Promise<void>}) {
 const {db,blobs,space,now}=options,blobPort=blobs.forModule('owned_exports');
 db.run('CREATE TABLE IF NOT EXISTS host_owned_export (id TEXT PRIMARY KEY,space TEXT NOT NULL,owner_kind TEXT NOT NULL,owner_id TEXT NOT NULL,actor_kind TEXT NOT NULL,actor_id TEXT NOT NULL,on_behalf TEXT,source TEXT NOT NULL,blob_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,at INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
 const get=(id:string):Row|null=>(db.all('SELECT * FROM host_owned_export WHERE id = ? AND space = ?',id,space)[0] as Row|undefined)??null;
 async function cleanup():Promise<void>{
  const expired=db.all('SELECT * FROM host_owned_export WHERE expires_at <= ? AND space = ?',now(),space) as unknown as Row[];
  for(const row of expired){await blobPort.delete(row.blob_id);db.run('DELETE FROM host_owned_export WHERE id = ? AND space = ?',row.id,space);if(row.source==='health.support_bundle')db.run('DELETE FROM health_bundle WHERE file_id = ?',row.id);if(row.source==='logs.export')db.run('DELETE FROM logs_export WHERE id = ?',row.id);}
 }
 function ownerOf(ctx:Execution):{kind:string;id:string}{return ctx.actingFor?{kind:'person',id:ctx.actingFor}:ctx.principal;}
 function authorize(ctx:Execution,source:Source):void{if(ctx.space!==space||ctx.authorize({perm:SOURCES[source].permission,level:'view'},{type:'space',id:space}).effect!=='allow')throw fail('permission.no_grant',ctx.trace.traceId,{message:'You cannot export these administrative records.'});}
 async function save(ctx:Execution,source:Source,value:unknown):Promise<string>{
  authorize(ctx,source);await cleanup();authorize(ctx,source);const owner=ownerOf(ctx),at=now(),definition=SOURCES[source];
  const text=source==='audit.export'?String(scrubExport(value)):source==='logs.export'?(value as unknown[]).map((row)=>JSON.stringify(scrubExport(row))).join('\n'):JSON.stringify(scrubExport(value));
  const bytes=new TextEncoder().encode(text);if(bytes.byteLength>EXPORT_MAX_BYTES)throw fail('validation.too_large',ctx.trace.traceId,{message:'This export is over 8 MB. Narrow the filters and try again.'});
  const id=`fil_${mintUuid(at).replaceAll('-','')}`,name=`${definition.name}-${new Date(at).toISOString().slice(0,10)}.${source==='audit.export'?'csv':source==='logs.export'?'jsonl':'json'}`;
  // No blob resource means the generic blob HTTP route can never bypass the exact-owner read below.
  const blob=await blobPort.put(bytes,definition.mime);
  try {
   authorize(ctx,source);
   db.run('INSERT INTO host_owned_export (id,space,owner_kind,owner_id,actor_kind,actor_id,on_behalf,source,blob_id,name,mime,size,at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,space,owner.kind,owner.id,ctx.principal.kind,ctx.principal.id,ctx.actingFor??null,source,blob.id,name,definition.mime,bytes.byteLength,at,at+EXPORT_TTL_MS);
   await options.register({id,ownerId:owner.id},ctx);authorize(ctx,source);
   if(now()>=at+EXPORT_TTL_MS)throw fail('permission.expired',ctx.trace.traceId,{message:'This export expired before it finished. Request it again.'});
   return id;
  } catch(error) {
   try {db.run('DELETE FROM host_owned_export WHERE id = ? AND space = ?',id,space);} finally {await blobPort.delete(blob.id);}
   throw error;
  }
 }
 function forExecution(cap:string,ctx:Execution):Record<string,unknown>|undefined{
  if(!Object.hasOwn(SOURCES,cap))return undefined;const source=cap as Source;authorize(ctx,source);
  if(source==='logs.export')return Object.freeze({logs:async(rows:readonly AdminLogEntry[])=>{if(!Array.isArray(rows)||rows.some((row)=>!object(row)||typeof row.at!=='number'||typeof row.msg!=='string'||Object.keys(row).some((key)=>!LOG_KEYS.has(key))))throw fail('validation.bad_input',ctx.trace.traceId,{message:'Invalid generated log export.'});return save(ctx,source,rows);}});
  if(source==='health.support_bundle')return Object.freeze({support:async(bundle:SupportExportContent)=>{if(!object(bundle)||typeof bundle.bundleId!=='string'||typeof bundle.createdAt!=='number'||bundle.space!==ctx.space||bundle.by!==ctx.principal.id||!object(bundle.parts)||Object.keys(bundle).some((key)=>!['bundleId','createdAt','space','by','health','paused','services','parts','missing'].includes(key))||Object.keys(bundle.parts).some((key)=>!['versions','recent'].includes(key)&&!/^trace:[a-f0-9]{32}$/i.test(key)))throw fail('validation.bad_input',ctx.trace.traceId,{message:'Invalid generated support bundle.'});return save(ctx,source,bundle);}});
  return Object.freeze({save:async(_name:string,csv:string)=>{if(typeof csv!=='string'||!csv.startsWith('at,actor,on_behalf_of,action,resource,class,trace_id,seq\n'))throw fail('validation.bad_input',ctx.trace.traceId,{message:'Invalid generated audit export.'});return save(ctx,source,csv);}});
 }
 async function read(cap:string,ctx:Execution,input:{fileId:string;as?:string;offset?:number;length?:number}):Promise<unknown>{
  await cleanup();const row=get(input.fileId),owner=ownerOf(ctx);
  if(!row||row.owner_kind!==owner.kind||row.owner_id!==owner.id)throw fail('permission.no_grant',ctx.trace.traceId,{message:'This private export belongs to another requester or has expired.'});authorize(ctx,row.source);
  if(cap==='files.get')return {file:{fileId:row.id,folderId:'fld_ownedexports',name:row.name,kind:row.mime==='text/csv'?'spreadsheet':'other',mime:row.mime,size:row.size,version:1,label:0,ownerId:row.owner_id,createdAt:row.at,updatedAt:row.at,updatedBy:row.actor_id,thumb:false,holds:0}};
  const blob=await blobPort.get(row.blob_id);if(!blob)throw fail('validation.not_found',ctx.trace.traceId,{message:'This private export has expired.'});
  authorize(ctx,row.source);const current=get(row.id),currentOwner=ownerOf(ctx);if(!current||current.blob_id!==row.blob_id||current.expires_at<=now()||current.owner_kind!==currentOwner.kind||current.owner_id!==currentOwner.id)throw fail('permission.no_grant',ctx.trace.traceId,{message:'This private export is no longer available to this requester.'});
  const start=input.offset??0,end=input.length===undefined?blob.bytes.length:Math.min(blob.bytes.length,start+input.length),bytes=blob.bytes.subarray(start,end);
  return {mime:row.mime,size:row.size,version:1,truncated:end<blob.bytes.length,...(input.as==='text'?{text:new TextDecoder().decode(bytes)}:input.as==='url'?{url:`data:${row.mime};base64,${Buffer.from(bytes).toString('base64')}`}:{base64:Buffer.from(bytes).toString('base64')})};
 }
 return {forExecution,read,has:(id:string)=>get(id)!==null,cleanup};
}
