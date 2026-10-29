export function pendingAction(out: unknown): string | null {
  if(!out||typeof out!=='object')return null;
  const value=out as {status?:string;state?:string};
  if(value.status==='held')return 'Waiting for approval. Open the approval in the app before continuing.';
  if(value.status==='pending'||value.status==='queued')return 'Requested. This action is still pending.';
  return null;
}
export const logFilter=(draft:{level:string;trace:string;cap:string;person:string}):Record<string,unknown>=>({limit:100,...(draft.level?{level:draft.level}:{}),...(draft.trace.trim()?{traceId:draft.trace.trim()}:{}),...(draft.cap.trim()?{cap:draft.cap.trim()}:{}),...(draft.person.trim()?{person:draft.person.trim()}: {})});
export const byteSize=(bytes:number|undefined):string=>bytes===undefined?'Unavailable':bytes>=1e9?`${(bytes/1e9).toFixed(1)} GB`:bytes>=1e6?`${(bytes/1e6).toFixed(1)} MB`:`${Math.round(bytes/1000)} KB`;
export function safeDownload(url:unknown):url is string{return typeof url==='string'&&(/^\/(?!\/)/.test(url)||(/^https:\/\//.test(url)||/^blob:https?:\/\//.test(url))||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url));}
