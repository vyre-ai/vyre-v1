import {authorize,type AccessSnapshot,type Req} from "../../../kernel/src/authorize/index.ts";
import type {Store,StoredRecord} from "../../../kernel/src/store/types.ts";
import type {CtxSeed} from "../invoke.ts";
import {fail} from "../routes/errors.ts";

const READS=new Set(["records.get","records.query","records.search","records.history"]);
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function createRecordAccess(ports:{store():Store;snapshot():AccessSnapshot;now():number;fresh():boolean}){
 function decision(seed:CtxSeed,row:StoredRecord){
  const snapshot=ports.snapshot();
  if(!ports.fresh())return null;
  const resource=snapshot.resource(row.id);if(!resource||resource.type!=="record")return null;
  const result=authorize(snapshot,{principal:seed.principal.id,actingFor:seed.actingFor,provider:seed.provider,action:{perm:null,level:"view"},resource:{type:"record",id:row.id},row:{...row.data,id:row.id,owner_id:resource.owner_id},now:ports.now()});
  return result.effect==="allow"?result:null;
 }
 function fields(seed:CtxSeed,row:StoredRecord,original:Record<string,unknown>,trace:string){
  const result=decision(seed,row);if(!result)throw fail("permission.no_grant",trace);
  const snapshot=ports.snapshot(),hidden=new Set(result.scope?.hiddenFields??[]),ceiling=result.scope?.labelCeiling??-1;
  return Object.fromEntries(Object.entries(original).filter(([key])=>!hidden.has(key)&&snapshot.fieldLabel(row.type,key)<=ceiling&&snapshot.fieldLabel("record",key)<=ceiling));
 }
 return{
  async facts(cap:string,input:unknown,req:Req,trace:string):Promise<Req>{
   if(cap==="records.query"){
    const value=object(input),type=value["type"],snapshot=ports.snapshot(),scope=authorize(snapshot,req).scope;
    if(typeof type==="string"&&scope){
     const touched:string[]=[];const visit=(item:unknown):void=>{if(Array.isArray(item)){item.forEach(visit);return;}if(!item||typeof item!=="object")return;const row=object(item);if(typeof row["field"]==="string")touched.push(row["field"]);Object.values(row).forEach(visit);};
     visit(value["filter"]);visit(value["sort"]);if(typeof value["group"]==="string")touched.push(value["group"]);
     if(touched.some(path=>{const field=path.split(".")[0]!;return scope.hiddenFields.includes(field)||snapshot.fieldLabel(type,field)>scope.labelCeiling||snapshot.fieldLabel("record",field)>scope.labelCeiling;}))throw fail("permission.no_grant",trace,{message:"Filtering, grouping or sorting by a hidden field is not allowed."});
    }
    return req;
   }
   if(!["records.get","records.history"].includes(cap))return req;
   const value=object(input);if(typeof value["type"]!=="string"||typeof value["recordId"]!=="string")return req;
   const row=await ports.store().get(value["type"],value["recordId"]);if(!row)return req;
   const resource=ports.snapshot().resource(row.id);
   return{...req,row:{...row.data,id:row.id,owner_id:resource?.owner_id??null},now:ports.now()};
  },
  async project(cap:string,input:unknown,seed:CtxSeed,output:unknown,trace:string):Promise<()=>unknown>{
   if(!READS.has(cap))return()=>output;
   const value=object(input),result=object(output);const type=value["type"];
   if(typeof type!=="string")throw fail("validation.bad_input",trace);
   if(cap==="records.history"){
    const id=value["recordId"];const row=typeof id==="string"?await ports.store().get(type,id):null;
    if(!row)throw fail("permission.no_grant",trace);
    return()=>{const visible=fields(seed,row,row.data,trace);return{...result,entries:(Array.isArray(result["entries"])?result["entries"]:[]).filter(entry=>typeof object(entry)["field"]==="string"&&Object.hasOwn(visible,object(entry)["field"] as string))};};
   }
   const originals=cap==="records.get"?[object(result["record"])]:Array.isArray(result["rows"])?result["rows"].map(object):[];
   const stored=await Promise.all(originals.map(row=>typeof row["id"]==="string"?ports.store().get(type,row["id"]):Promise.resolve(null)));
   return()=>{
    const rows=originals.flatMap((original,index)=>{const row=stored[index];if(!row||!decision(seed,row))return[];const visible=fields(seed,row,object(original["fields"]),trace);
     if(cap==="records.search"){const words=String(value["q"]??"").toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu)??[];const body=Object.values(visible).filter(item=>typeof item==="string").join(" ").toLocaleLowerCase();const actual=body.match(/[\p{L}\p{N}_]+/gu)??[];if(!words.length||!words.every(word=>actual.some(item=>item.startsWith(word))))return[];}
     return[{...original,fields:visible}];});
    if(cap==="records.get"){if(!rows[0])throw fail("permission.no_grant",trace);return{...result,record:rows[0]};}
    const{total:_total,...rest}=result;return{...rest,rows};
   };
  },
 };
}
