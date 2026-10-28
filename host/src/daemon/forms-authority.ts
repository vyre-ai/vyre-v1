import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
/** A published upload grants no new authority: its saved owner must still edit the form and write this live local folder. */
export function formUploadAllowed(snapshot: AccessSnapshot, input: { publisherId: string; formId: string; folderId: string; liveLocalFolder: boolean; stale: boolean; now: number }): boolean {
  if(input.stale||!input.liveLocalFolder)return false;
  const request={principal:input.publisherId,now:input.now};
  return authorize(snapshot,{...request,action:{perm:'forms.publish',level:'edit'},resource:{type:'form',id:input.formId}}).effect==='allow'
    &&authorize(snapshot,{...request,action:{perm:'files.write',level:'edit'},resource:{type:'folder',id:input.folderId}}).effect==='allow';
}
