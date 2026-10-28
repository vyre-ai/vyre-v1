import { useConsoleData } from "../shell/data.tsx";
import { useRead } from "../pages/shared.tsx";
export const typeName = (kind: string): string => kind.replaceAll("_", " ").replace(/^./,(first)=>first.toUpperCase());
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function useIdentityName(ref:{kind:string;id:string}):string{
 const data=useConsoleData();
 const field=ref.kind==="role"?"role":ref.kind==="group"?"group":"principal";
 const enabled=["role","group","person","agent","actor","service"].includes(ref.kind);
 const input=ref.kind==="role"?{roleId:ref.id}:ref.kind==="group"?{groupId:ref.id}:{principal:ref};
 const read=useRead<Record<string,unknown>>(`access.${ref.kind==="role"?"roles":ref.kind==="group"?"groups":"principals"}.get`,input,{enabled});
 const name=object(read.data?.[field]).name;
 const known=data.name(ref.id);
 return typeof name==="string"&&name!==ref.id?name:known!==ref.id?known:typeName(ref.kind);
}
export function useResourceName(ref:{type:string;id:string}):string{
 const data=useConsoleData();
 const adapters:Record<string,{cap:string;input:string;field:string;label:string}>={folder:{cap:"files.folder.get",input:"folderId",field:"folder",label:"name"},file:{cap:"files.get",input:"fileId",field:"file",label:"name"},project:{cap:"projects.get",input:"projectId",field:"project",label:"title"},agent:{cap:"agents.get",input:"agentId",field:"agent",label:"name"},channel:{cap:"channels.get",input:"channelId",field:"channel",label:"name"}};
 const adapter=adapters[ref.type];
 const read=useRead<Record<string,unknown>>(adapter?.cap??"access.lists",adapter?{[adapter.input]:ref.id}:{type:ref.type,limit:100},{enabled:!!adapter});
 const name=adapter?object(read.data?.[adapter.field])[adapter.label]:undefined;
 if(ref.type==="space"&&ref.id===data.space.id)return data.space.name;
 const known=data.name(ref.id);
 return typeof name==="string"&&name!==ref.id?name:known!==ref.id?known:typeName(ref.type);
}
