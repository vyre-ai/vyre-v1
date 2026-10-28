import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePreviewLoader } from '../pages/backup-preview.ts';
import type { RestorePreviewState } from '../pages/backup-preview.ts';
const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
test('only the latest selected backup can become confirmable when preview responses arrive out of order',async()=>{
 const a=deferred<number>(),b=deferred<number>();let state:RestorePreviewState<number>={status:'idle'};
 const loader=restorePreviewLoader(id=>id==='a'?a.promise:b.promise,next=>{state=next;});
 const old=loader.select('a'),latest=loader.select('b');assert.deepEqual(state,{status:'loading',backupId:'b'});
 b.resolve(2);await latest;assert.deepEqual(state,{status:'ready',backupId:'b',value:2});a.resolve(1);await old;assert.deepEqual(state,{status:'ready',backupId:'b',value:2});
});
test('selecting a new backup clears old confirmation, failure keeps it cleared and cancel ignores late responses',async()=>{
 const pending=deferred<number>();let state:RestorePreviewState<number>={status:'idle'};
 const loader=restorePreviewLoader(id=>id==='a'?Promise.resolve(1):pending.promise,next=>{state=next;});await loader.select('a');const newer=loader.select('b');assert.deepEqual(state,{status:'loading',backupId:'b'});pending.reject(new Error('fixture denied'));await newer;assert.equal(state.status,'error');
 const late=deferred<number>(),cancelled=restorePreviewLoader(()=>late.promise,next=>{state=next;});const request=cancelled.select('c');cancelled.cancel();late.resolve(3);await request;assert.deepEqual(state,{status:'idle'});
});
