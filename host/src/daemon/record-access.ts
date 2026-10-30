import {authorize,type AccessSnapshot,type Req} from "../../../kernel/src/authorize/index.ts";
import type {Store,StoredRecord} from "../../../kernel/src/store/types.ts";
import type {CtxSeed} from "../invoke.ts";
import {fail} from "../routes/errors.ts";
import {recordSensitivity} from "./record-sensitivity.ts";
import {canonical} from "../../../lib/canonical.ts";
import type {Filter,Sort} from "../../../kernel/src/store/types.ts";

type ReadSeed=CtxSeed&{readCap?:string;readInput?:unknown;labels?:Readonly<Record<string,number>>};
const READS=new Set(["records.get","records.query","records.search","records.history"]);
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function createRecordAccess(ports:{store():Store;snapshot():AccessSnapshot;now():number;fresh():boolean;refresh?():Promise<void>}){
 const cursors=new Map<string,{key:string;cursor:string;expires:number;skip:number}>();
 const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,"0")).join("");
 function related(resourceId:string|null,type:string):boolean{const snapshot=ports.snapshot();return resourceId!==null&&(snapshot.chain(type)?.some(parent=>parent.id===resourceId)===true||snapshot.chain(resourceId)?.some(parent=>parent.id===type)===true);}
 function subjects(req:Req):string[]{const output=[req.principal,...(req.actingFor?[req.actingFor]:[])];for(let at=0;at<output.length;at++){const info=ports.snapshot().info(output[at]!);if(info?.p.kind==="svc"&&info.p.owner&&!output.includes(info.p.owner))output.push(info.p.owner);}return output;}
 function assertFields(req:Req,type:string,labels:Readonly<Record<string,number>>,touched:readonly string[],trace:string):void{
  if(!touched.length)return;
  const snapshot=ports.snapshot();
  for(const principal of subjects(req)){
   const info=snapshot.info(principal);if(!info)throw fail("permission.no_grant",trace);
   const exact=authorize(snapshot,{...req,principal,actingFor:undefined});
   const grants=snapshot.allGrantRecs().filter(grant=>info.keys.has(grant.key)&&grant.rank>=1&&grant.exp>ports.now()&&grant.nb<=ports.now()&&grant.na>=ports.now()&&(related(grant.row.resource_id,type)||(grant.row.resource_id===null&&grant.row.resource_type==="record")));
   const hidden=new Set(exact.effect==="allow"?exact.scope?.hiddenFields??[]:grants.flatMap(grant=>[...grant.hidden]));
   let ceiling=exact.effect==="allow"?exact.scope?.labelCeiling??-1:Math.min(info.clearance,...grants.map(grant=>grant.ceiling));
   if(req.provider)for(const policy of snapshot.policies())if(policy.kind==="provider_label")ceiling=Math.min(ceiling,policy.allow[req.provider]??policy.defaultMax??Infinity);
   if(touched.some(path=>{const field=path.split(".")[0]!;return hidden.has(field)||(!["id","version","created_at","updated_at"].includes(field)&&labels[field]===undefined)||(labels[field]??0)>ceiling||snapshot.fieldLabel(type,field)>ceiling||snapshot.fieldLabel("record",field)>ceiling;}))throw fail("permission.no_grant",trace,{message:"Filtering, grouping or sorting by a hidden field is not allowed."});
  }
 }
 function mayRead(req:Req,type:string):boolean{
  const snapshot=ports.snapshot();if(!ports.fresh()||snapshot.resource(type)?.type!=="record_type")return false;
  const required=[req.principal,...(req.actingFor?[req.actingFor]:[])];
  for(let at=0;at<required.length;at++){const info=snapshot.info(required[at]!);if(!info||info.p.status!=="active")return false;if(info.p.kind==="agent"&&!req.actingFor)return false;if(info.p.kind==="svc"&&info.p.owner&&!required.includes(info.p.owner))required.push(info.p.owner);}
  return required.every(principal=>{
   const direct=authorize(snapshot,{...req,principal,actingFor:undefined,resource:{type:"record_type",id:type}});if(direct.effect==="allow")return true;
   const info=snapshot.info(principal)!;
   for(const grant of snapshot.allGrantRecs()){
    if(!info.keys.has(grant.key)||grant.rank<1||grant.exp<=ports.now()||grant.nb>ports.now()||grant.na<ports.now())continue;
    if(grant.row.resource_id===null&&grant.row.resource_type==="record")return true;
    const resource=grant.row.resource_id?snapshot.resource(grant.row.resource_id):undefined;
    if(resource&&related(resource.id,type))return true;
   }
   return [...snapshot.allResources()].some(resource=>resource.type==="record"&&resource.owner_id===principal&&snapshot.chain(resource.id)?.some(parent=>parent.id===type));
  });
 }
 function references(value:unknown):string[]{const output:string[]=[];const visit=(item:unknown):void=>{if(Array.isArray(item)){item.forEach(visit);return;}if(!item||typeof item!=="object")return;const row=object(item);if(typeof row["field"]==="string")output.push(row["field"]);Object.values(row).forEach(visit);};visit(value);return output;}
 function decision(seed:ReadSeed,row:StoredRecord){
  const snapshot=ports.snapshot();
  if(!ports.fresh())return null;
  const resource=snapshot.resource(row.id);if(!resource||resource.type!=="record")return null;
  const result=authorize(snapshot,{principal:seed.principal.id,actingFor:seed.actingFor,provider:seed.provider,cap:seed.readCap,input:seed.readInput,action:{perm:null,level:"view"},resource:{type:"record",id:row.id},row:{...row.data,id:row.id,owner_id:resource.owner_id},now:ports.now()});
  return result.effect==="allow"?result:null;
 }
 function fields(seed:ReadSeed,row:StoredRecord,original:Record<string,unknown>,trace:string){
  const result=decision(seed,row);if(!result)throw fail("permission.no_grant",trace);
  const snapshot=ports.snapshot(),hidden=new Set(result.scope?.hiddenFields??[]);let ceiling=result.scope?.labelCeiling??-1;if(seed.provider)for(const policy of snapshot.policies())if(policy.kind==="provider_label")ceiling=Math.min(ceiling,policy.allow[seed.provider]??policy.defaultMax??Infinity);
  return Object.fromEntries(Object.entries(original).filter(([key])=>!hidden.has(key)&&seed.labels?.[key]!==undefined&&seed.labels[key]<=ceiling&&snapshot.fieldLabel(row.type,key)<=ceiling&&snapshot.fieldLabel("record",key)<=ceiling));
 }
 return{
  async collection(cap:string,input:unknown,seed:ReadSeed,req:Req,trace:string):Promise<{finish():unknown}|null>{
   if(!["records.query","records.search","records.counts"].includes(cap))return null;
   seed={...seed,readCap:cap,readInput:input};
   const value=object(input),type=value["type"];if(typeof type!=="string")throw fail("validation.bad_input",trace);
   if(!mayRead(req,type))throw fail("permission.no_grant",trace);
   seed={...seed,labels:await recordSensitivity(ports.store(),type,trace)};
   const snapshot=ports.snapshot(),parent=authorize(snapshot,req),scope=parent.scope;
   if(parent.effect==="hold")throw fail("permission.needs_approval",trace);
   if(parent.effect==="allow"&&scope&&!scope.rowFilter&&!scope.hiddenFields.length&&scope.labelCeiling>=3&&!seed.provider)return null;
   const children=[...snapshot.allResources()].filter(resource=>resource.type==="record"&&snapshot.chain(resource.id)?.some(parent=>parent.id===type));
   // Keep the existing indexed query/FTS path for unrestricted callers. The
   // scoped path below pages authorized rows, rather than filtering a raw page.
   if(!seed.provider&&parent.effect==="allow"&&scope&&!scope.rowFilter&&!scope.hiddenFields.length&&children.every(resource=>resource.label<=scope.labelCeiling)){
    const definition=await ports.store().describe(type);
    if(definition?.fields.every(field=>(seed.labels?.[field.name]??0)<=scope.labelCeiling&&snapshot.fieldLabel(type,field.name)<=scope.labelCeiling&&snapshot.fieldLabel("record",field.name)<=scope.labelCeiling))return null;
   }
   await this.facts("records.query",input,req,trace);
   const{cursor:_cursor,offset:_offset,...query}=value,key=canonical({cap,query,principal:seed.principal,actingFor:seed.actingFor??null,provider:seed.provider??null,space:seed.space});
   let cursor:string|undefined;let remainingSkip:number|undefined;
   if(value["cursor"]!==undefined){const saved=typeof value["cursor"]==="string"?cursors.get(value["cursor"]):undefined;if(!saved||saved.key!==key||saved.expires<=ports.now())throw fail("validation.bad_input",trace,{message:"This page expired. Refresh the list."});cursor=saved.cursor;remainingSkip=saved.skip;}
   const limit=typeof value["limit"]==="number"?value["limit"]:cap==="records.search"?50:200;
   let skip=remainingSkip??(typeof value["offset"]==="number"?value["offset"]:0);
   if(!Number.isInteger(skip)||skip<0)throw fail("validation.bad_input",trace);
   const sort=[...(Array.isArray(value["sort"])?value["sort"]:[])] as Sort[];
   if(typeof value["group"]==="string"&&!sort.some(row=>row.field===value["group"]))sort.unshift({field:value["group"],dir:"asc"});
   const touched=[...references(value["filter"]),...sort.map(row=>row.field)].map(field=>field.split(".")[0]!);
   assertFields(req,type,seed.labels??{},touched,trace);
   const requested=Array.isArray(value["fields"])?new Set(value["fields"] as string[]):null;
   const words=cap==="records.search"?(String(value["q"]??"").toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu)??[]):[];
   const rows:StoredRecord[]=[];let scanned=0;
   do{
    const before=cursor;
    const page=await ports.store().query(type,{...(value["filter"]!==undefined?{filter:value["filter"] as Filter}:{}),...(sort.length?{sort}:{}),page:{limit:1,...(cursor?{cursor}:{})}});
    if(!mayRead(req,type))throw fail("permission.no_grant",trace);
    const row=page.rows[0];cursor=page.next_cursor;scanned++;
    if(row&&decision(seed,row)){
     const visible=fields(seed,row,row.data,trace);
     const sortable=touched.every(field=>["id","version","created_at","updated_at"].includes(field)||Object.hasOwn(visible,field));
     const actual=Object.values(visible).filter(item=>typeof item==="string").join(" ").toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu)??[];
     if(sortable&&(cap!=="records.search"||(words.length>0&&words.every(word=>actual.some(item=>item.startsWith(word)))))){
      if(cap==="records.counts")rows.push(row);
      else if(skip>0)skip--;else {rows.push(row);if(rows.length>limit){rows.pop();cursor=before;break;}}
     }
    }
    if(cap==="records.counts"&&cursor&&scanned>=5000)throw fail("validation.precondition_failed",trace,{message:"This restricted count exceeds the 5,000-row scan limit. Narrow the filter and retry."});
    if(cap!=="records.counts"&&(scanned>=2000))break;
   }while(cursor);
   let next:string|undefined;
   if(cursor&&cap!=="records.counts"){
    for(const[token,saved]of cursors)if(saved.expires<=ports.now())cursors.delete(token);
    if(cursors.size>=2000)cursors.delete(cursors.keys().next().value!);
    next=random();cursors.set(next,{key,cursor,expires:ports.now()+3600000,skip});
   }
   return{finish:async()=>{
    seed={...seed,labels:await recordSensitivity(ports.store(),type,trace)};
    if(!mayRead(req,type))throw fail("permission.no_grant",trace);
    assertFields(req,type,seed.labels??{},touched,trace);
    if(cap==="records.counts")return{count:rows.filter(row=>{if(!decision(seed,row))return false;const visible=fields(seed,row,row.data,trace);return touched.every(field=>["id","version","created_at","updated_at"].includes(field)||Object.hasOwn(visible,field));}).length};
    return{rows:rows.flatMap(row=>{const result=decision(seed,row);if(!result)return[];const resource=ports.snapshot().resource(row.id)!;const projected=fields(seed,row,row.data,trace);if(!touched.every(field=>["id","version","created_at","updated_at"].includes(field)||Object.hasOwn(projected,field)))return[];if(cap==="records.search"){const actual=Object.values(projected).filter(item=>typeof item==="string").join(" ").toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu)??[];if(!words.every(word=>actual.some(item=>item.startsWith(word))))return[];}return[{id:row.id,type:row.type,version:row.version,label:resource.label,fields:requested?Object.fromEntries(Object.entries(projected).filter(([field])=>requested.has(field))):projected,createdAt:row.created_at,updatedAt:row.updated_at,holds:resource.holds}];}),...(next?{next}:{})};
   }};
  },
  async facts(cap:string,input:unknown,req:Req,trace:string):Promise<Req>{
   if(cap==="records.query"){
    const value=object(input),type=value["type"];
    if(typeof type==="string"){const labels=await recordSensitivity(ports.store(),type,trace);
     const touched:string[]=[];const visit=(item:unknown):void=>{if(Array.isArray(item)){item.forEach(visit);return;}if(!item||typeof item!=="object")return;const row=object(item);if(typeof row["field"]==="string")touched.push(row["field"]);Object.values(row).forEach(visit);};
     visit(value["filter"]);visit(value["sort"]);if(typeof value["group"]==="string")touched.push(value["group"]);
     assertFields(req,type,labels,touched,trace);
    }
    return req;
   }
   if(!["records.get","records.history"].includes(cap))return req;
   const value=object(input);if(typeof value["type"]!=="string"||typeof value["recordId"]!=="string")return req;
   const row=await ports.store().get(value["type"],value["recordId"]);if(!row)return req;
   const resource=ports.snapshot().resource(row.id);
   return{...req,row:{...row.data,id:row.id,owner_id:resource?.owner_id??null},now:ports.now()};
  },
  async project(cap:string,input:unknown,seed:ReadSeed,output:unknown,trace:string):Promise<()=>unknown>{
   if(!READS.has(cap))return()=>output;
   seed={...seed,readCap:cap,readInput:input};
   const value=object(input),result=object(output);const type=value["type"];
   if(typeof type!=="string")throw fail("validation.bad_input",trace);
   if(cap==="records.history"){
    const id=value["recordId"];const row=typeof id==="string"?await ports.store().get(type,id):null;
    if(!row)throw fail("permission.no_grant",trace);
    return async()=>{seed={...seed,labels:await recordSensitivity(ports.store(),type,trace)};const visible=fields(seed,row,row.data,trace);return{...result,entries:(Array.isArray(result["entries"])?result["entries"]:[]).filter(entry=>typeof object(entry)["field"]==="string"&&Object.hasOwn(visible,object(entry)["field"] as string))};};
   }
   const originals=cap==="records.get"?[object(result["record"])]:Array.isArray(result["rows"])?result["rows"].map(object):[];
   const stored=await Promise.all(originals.map(row=>typeof row["id"]==="string"?ports.store().get(type,row["id"]):Promise.resolve(null)));
   return async()=>{
    seed={...seed,labels:await recordSensitivity(ports.store(),type,trace)};
    const read=()=>originals.flatMap((original,index)=>{const row=stored[index];if(!row||!decision(seed,row))return[];const visible=fields(seed,row,object(original["fields"]),trace);
     if(cap==="records.query"){const touched=[...references(value["filter"]),...references(value["sort"]),...(typeof value["group"]==="string"?[value["group"]]:[])].map(field=>field.split(".")[0]!);const complete=fields(seed,row,row.data,trace);if(touched.some(field=>!["id","version","created_at","updated_at"].includes(field)&&Object.hasOwn(row.data,field)&&!Object.hasOwn(complete,field)))throw fail("permission.no_grant",trace);}
     if(cap==="records.search"){const words=String(value["q"]??"").toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu)??[];const body=Object.values(visible).filter(item=>typeof item==="string").join(" ").toLocaleLowerCase();const actual=body.match(/[\p{L}\p{N}_]+/gu)??[];if(!words.length||!words.every(word=>actual.some(item=>item.startsWith(word))))return[];}
     return[{...original,fields:visible}];});
    // A row the read returned may belong to a record this Space wrote a moment ago (a run, a hook) whose access entry the snapshot has not folded yet. Fold what is pending and read once more before calling it a change of access: a real change (a grant taken away, a record removed) is still refused after the second read.
    let rows=read();
    if(rows.length!==originals.length&&ports.refresh){await ports.refresh();rows=read();}
    if(cap==="records.get"){if(!rows[0])throw fail("permission.no_grant",trace);return{...result,record:rows[0]};}
    if(rows.length!==originals.length)throw fail("validation.precondition_failed",trace,{message:"Access changed while reading. Refresh the list."});
    const{total:_total,...rest}=result;return{...rest,rows};
   };
  },
 };
}
