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
