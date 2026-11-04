import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConsoleDataProvider} from '../shell/data.tsx';
import {createSampleConsole} from '../shell/sample.ts';
import {Server,Diagnostics,Support} from '../pages/Infrastructure.tsx';
import {pendingAction,logFilter,safeDownload} from '../pages/infra-model.ts';
const draw=(element:React.ReactElement,rows:Record<string,unknown>):string=>{const base=createSampleConsole().data;const data={...base,screens:{...base.screens,capQuery:(cap:string)=>{const value={status:'ready',data:rows[cap]};return{subscribe:()=>()=>undefined,getSnapshot:()=>value};}} as never};return renderToStaticMarkup(<ConsoleDataProvider value={data}>{element}</ConsoleDataProvider>);};
test('held and queued actions do not imply completion; filters omit blank values and downloads refuse executable URLs',()=>{
 assert.match(pendingAction({status:'held'})! ,/Waiting for approval/);assert.match(pendingAction({status:'pending'})!,/still pending/);assert.equal(pendingAction({runId:'run_fixture'}),null);assert.deepEqual(logFilter({level:'error',trace:'',cap:' files.read ',person:''}),{limit:100,level:'error',cap:'files.read'});assert.equal(safeDownload('javascript:alert(1)'),false);assert.equal(safeDownload('/blob/fixture'),true);
});
test('Diagnostics renders real failed checks with next steps and a run action',()=>{
 const html=draw(<Diagnostics/>,{'health.status':{overall:'degraded',checks:[{key:'host.disk_space',title:'Disk space',state:'degraded',checkedAt:1,module:'host',next:'Free disk space',detail:'Low disk'}]},'health.machine':{state:'healthy',machine:{diskFreeBytes:2e9}},'health.disk_space':{state:'healthy',freeBytes:2e9}});assert.match(html,/Disk space/);assert.match(html,/Low disk|Free disk space/);assert.match(html,/infra-run-checks/);assert.doesNotMatch(html,/not implemented/);
});
test('Support shows actual doctor findings and a bundle action; Server mounts typed filters',()=>{
 assert.match(draw(<Support/>,{'health.doctor':{ok:false,findings:[{key:'test',state:'degraded',next:'Run the check again'}]}}),/Run the check again|infra-support-create/);
 assert.match(draw(<Server/>,{'logs.query':{rows:[]}}),/infra-log-search|Server logs/);
});
// Diagnostics > Details: the Kit's blocked actions, the Doctor's raw checks and a field that takes the id from an error message.
import { createRoot } from 'test-renderer';
import {mountPage} from './page-kit.tsx';
const DIAG={'health.status':{overall:'healthy',checks:[]},'health.machine':{state:'healthy',machine:{diskFreeBytes:2e9}},'health.disk_space':{state:'healthy',freeBytes:2e9},'health.disk_encrypted':{state:'healthy'},
 'health.doctor':{ok:false,findings:[{key:'disk.free',state:'degraded',next:'Free some space'}]},'kits.list':{kits:[{kitId:'kit_1',key:'vyre',title:'Vyre Kit',version:'1.0.0',channel:'stable',installed:true,contents:['ui']}]},'kits.health':{state:'degraded',denials:3}};
test('Details starts closed, opens the blocked actions and debug output, and hides again',async()=>{
 const p=await mountPage(createRoot, <Diagnostics/>,DIAG);
 try{
  assert.ok(!p.has('diagnostics-details'));assert.match(p.text(),/Blocked actions, debug output and ids for support/);
  await p.press('diagnostics-details-toggle');
  assert.ok(p.has('diagnostics-details'));assert.match(p.text(),/Vyre Kit/);assert.match(p.text(),/3\s+actions\s+blocked/);assert.match(p.text(),/Free some space/);assert.match(p.text(),/Hide details/);
  await p.press('diagnostics-details-toggle');assert.ok(!p.has('diagnostics-details'));
 }finally{p.restore();}
});
test('Look up an error takes the id from an error message and reads logs.trace; a short id is refused',async()=>{
 const id='a1b2c3d4e5f60718293a4b5c6d7e8f90';
 const p=await mountPage(createRoot, <Diagnostics/>,DIAG,(cap)=>cap==='logs.trace'?{logs:[{id:1,at:1,level:'error',msg:'The tool was blocked',traceId:id}],spans:[],events:[]}:{ok:true});
 try{
  await p.press('diagnostics-details-toggle');
  await p.type('diagnostics-lookup-id','abc');await p.press('diagnostics-lookup');
  assert.equal(p.called('logs.trace').length,0);assert.match(p.text(),/32-character id/);
  await p.type('diagnostics-lookup-id',id);await p.press('diagnostics-lookup');
  assert.deepEqual(p.called('logs.trace').at(-1)!.input,{traceId:id});assert.match(p.text(),/The tool was blocked/);assert.match(p.text(),/Error details/);
 }finally{p.restore();}
});
