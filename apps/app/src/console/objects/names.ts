import {useEffect,useState} from "react";
import { useConsoleData } from "../shell/data.tsx";
import { useRead } from "../pages/shared.tsx";
export const typeName = (kind: string): string => kind.replaceAll("_", " ").replace(/^./,(first)=>first.toUpperCase());
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function useIdentityName(ref:{kind:string;id:string}):string{
 const data=useConsoleData();
 const field=ref.kind==="role"?"role":ref.kind==="group"?"group":"principal";
 const enabled=!!ref.id&&["role","group","person","agent","actor","service"].includes(ref.kind);
 const input=ref.kind==="role"?{roleId:ref.id}:ref.kind==="group"?{groupId:ref.id}:{principal:ref};
 const read=useRead<Record<string,unknown>>(`access.${ref.kind==="role"?"roles":ref.kind==="group"?"groups":"principals"}.get`,input,{enabled});
 const name=object(read.data?.[field]).name;
 const known=data.name(ref.id);
 return ref.id===data.me.id?data.me.name:typeof name==="string"&&name!==ref.id?name:known!==ref.id?known:typeName(ref.kind);
}
export function useResourceName(ref:{type:string;id:string}):string{
 const data=useConsoleData();
 const adapters:Record<string,{cap:string;input:string;field:string;label:string}>={folder:{cap:"files.folder.get",input:"folderId",field:"folder",label:"name"},file:{cap:"files.get",input:"fileId",field:"file",label:"name"},project:{cap:"projects.get",input:"projectId",field:"project",label:"title"},agent:{cap:"agents.get",input:"agentId",field:"agent",label:"name"},channel:{cap:"channels.get",input:"channelId",field:"channel",label:"name"}};
 const adapter=adapters[ref.type];
 const read=useRead<Record<string,unknown>>(adapter?.cap??"access.lists",adapter?{[adapter.input]:ref.id}:{type:ref.type,limit:100},{enabled:!!adapter});
 const name=adapter?object(read.data?.[adapter.field])[adapter.label]:undefined;
 if(ref.type==="space"&&ref.id===data.space.id)return data.space.name;
 const known=data.name(ref.id);
 return ref.type==="space"&&ref.id===data.space.id?data.space.name:typeof name==="string"&&name!==ref.id?name:known!==ref.id?known:typeName(ref.type);
}

/** Resolve only the visible page, through the caller's ordinary authorized read capabilities. */
export function useObjectNames(refs:{identities:readonly {kind:string;id:string}[];resources:readonly {type:string;id:string}[]}){
 const data=useConsoleData();const[labels,setLabels]=useState<Record<string,string>>({});const key=JSON.stringify(refs);
 useEffect(()=>{let live=true;setLabels({});const current=JSON.parse(key) as typeof refs;const requests=new Map<string,{cap:string;input:unknown;field:string;label:string}>();
  for(const ref of current.identities){if(!["person","agent","actor","service","role","group"].includes(ref.kind))continue;const entity=ref.kind==="role"?"roles":ref.kind==="group"?"groups":"principals";requests.set(`i:${ref.kind}:${ref.id}`,{cap:`access.${entity}.get`,input:ref.kind==="role"?{roleId:ref.id}:ref.kind==="group"?{groupId:ref.id}:{principal:ref},field:entity==="roles"?"role":entity==="groups"?"group":"principal",label:"name"});}
  for(const ref of current.resources){const request=resourceNameRequest(ref);if(request)requests.set(`r:${ref.type}:${ref.id}`,request);}
  void Promise.all([...requests].map(async([id,request])=>{try{const out=object(await data.call(request.cap,request.input));const title=object(out[request.field])[request.label];return typeof title==="string"&&title&&!/^(usr|agt|act|svc|grp|rol|fld|fil|prj)_[a-z0-9]+$/.test(title)?[id,title] as const:null;}catch{return null;}})).then(results=>{if(live)setLabels(Object.fromEntries(results.filter((row):row is readonly[string,string]=>row!==null)));});
  return()=>{live=false;};
 },[data.call,data.me.id,data.space.id,key]);
 const known=(id:string,kind:string)=>id===data.me.id?data.me.name:data.name(id)!==id?data.name(id):typeName(kind);
 return {identity:(ref:{kind:string;id:string})=>ref.id===data.me.id?data.me.name:labels[`i:${ref.kind}:${ref.id}`]??known(ref.id,ref.kind),resource:(ref:{type:string;id:string})=>ref.type==="space"&&ref.id===data.space.id?data.space.name:labels[`r:${ref.type}:${ref.id}`]??known(ref.id,ref.type)};
}
export function resourceNameRequest(ref:{type:string;id:string}):{cap:string;input:unknown;field:string;label:string}|null{
 const adapters:Record<string,{cap:string;input:string;field:string;label:string}>={folder:{cap:"files.folder.get",input:"folderId",field:"folder",label:"name"},file:{cap:"files.get",input:"fileId",field:"file",label:"name"},project:{cap:"projects.get",input:"projectId",field:"project",label:"title"},agent:{cap:"agents.get",input:"agentId",field:"agent",label:"name"},channel:{cap:"channels.get",input:"channelId",field:"channel",label:"name"},task:{cap:"tasks.get",input:"taskId",field:"task",label:"title"}};const adapter=adapters[ref.type];return adapter?{cap:adapter.cap,input:{[adapter.input]:ref.id},field:adapter.field,label:adapter.label}:null;
}
