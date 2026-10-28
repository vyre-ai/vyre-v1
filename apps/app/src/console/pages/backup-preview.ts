// A destructive restore must always confirm the most recent explicit selection.
export type RestorePreviewState<T> = {status:'idle'} | {status:'loading';backupId:string} | {status:'ready';backupId:string;value:T} | {status:'error';backupId:string;message:string};
export function restorePreviewLoader<T>(load:(backupId:string)=>Promise<T>,publish:(state:RestorePreviewState<T>)=>void) {
 let revision=0;
 return {
  async select(backupId:string):Promise<void> {
   const request=++revision;publish({status:'loading',backupId});
   try {const value=await load(backupId);if(request===revision)publish({status:'ready',backupId,value});}
   catch {if(request===revision)publish({status:'error',backupId,message:'Couldn’t preview this restore. No backup is selected for restore. Check access and try again.'});}
  },
  cancel():void {revision++;publish({status:'idle'});},
  invalidate():void {revision++;},
 };
}
