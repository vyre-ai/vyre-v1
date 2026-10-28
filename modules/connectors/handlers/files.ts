import type { ConnectorsCtx } from '../projections.ts';
import { refuse } from '../projections.ts';

/** Handler-generated connector sources only, written through the original caller's normal Files capabilities. */
export async function writeConnectorFolder(ctx: ConnectorsCtx, key: string, files: {path:string;content:string}[]): Promise<string> {
 if (files.length > 500 || files.reduce((sum,file)=>sum+new TextEncoder().encode(file.content).length,0)>5*1024*1024) refuse(ctx,'validation.too_large','This connector is too large to export.');
 for(const file of files) if(!/^(?:actions\/|tests\/)?[^/\\\x00-\x1f]{1,180}$/.test(file.path)||file.path.split('/').some(part=>part==='.'||part==='..')) refuse(ctx,'validation.bad_input','A connector source path is not valid.');
 const tree=await ctx.call('files.tree',{}) as {roots:{key:string;folderId?:string}[]};
 const parentId=tree.roots.find(root=>root.key==='personal')?.folderId;
 if(!parentId)return refuse(ctx,'internal.unavailable','Your Personal Files folder is unavailable.');
 const made=await ctx.call('files.folder.create',{parentId,name:`${key} connector ${ctx.trace.traceId.slice(0,8)}`,idempotencyKey:`connector-folder:${ctx.trace.traceId}:${key}`}) as {folder:{folderId:string}};
 const folderId=made.folder.folderId,dirs=new Map<string,string>();
 for(const file of files){const parts=file.path.split('/');let target=folderId;const name=parts.at(-1)!;if(parts.length===2){const part=parts[0]!;let child=dirs.get(part);if(!child){const out=await ctx.call('files.folder.create',{parentId:folderId,name:part,idempotencyKey:`connector-dir:${ctx.trace.traceId}:${part}`}) as {folder:{folderId:string}};child=out.folder.folderId;dirs.set(part,child);}target=child;}await ctx.call('files.create',{folderId:target,name,content:{text:file.content},mime:name.endsWith('.md')?'text/markdown':name.endsWith('.json')?'application/json':'text/plain',kind:name.endsWith('.md')?'markdown':'code',idempotencyKey:`connector-source:${ctx.trace.traceId}:${file.path}`});}
 return folderId;
}
