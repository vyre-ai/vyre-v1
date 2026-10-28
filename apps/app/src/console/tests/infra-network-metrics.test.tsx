import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsoleDataProvider } from '../shell/data.tsx';
import { createSampleConsole } from '../shell/sample.ts';
import { consolePageFor } from '../../shell/providers/console.tsx';
import { Network } from '../pages/InfrastructureNetwork.tsx';
import { Speed, Usage, speedValue } from '../pages/InfrastructureMetrics.tsx';
const draw=(element:React.ReactElement,rows:Record<string,unknown>):string=>{const base=createSampleConsole().data;const data={...base,screens:{...base.screens,capQuery:(cap:string)=>{const value={status:'ready',data:rows[cap]};return{subscribe:()=>()=>undefined,getSnapshot:()=>value};}} as never};return renderToStaticMarkup(<ConsoleDataProvider value={data}>{element}</ConsoleDataProvider>);};
test('Network shows observed status, endpoints and servers with reviewed actions',()=>{
 const html=draw(<Network/>,{'network.status':{address:'fixture.vyre.test',mode:'relay',certificate:{host:'fixture.vyre.test',state:'degraded'},publicIngress:false},'network.endpoints':{endpoints:[{kind:'relay',url:'https://fixture.vyre.test',health:'degraded',rttMs:42}]},'network.public_hostnames':{hosts:[]},'network.servers':{servers:[{serverId:'srv_1',name:'Fixture server',state:'down',role:'compute'}]}});
 assert.match(html,/fixture.vyre.test/);assert.match(html,/Degraded/);assert.match(html,/42 ms/);assert.match(html,/Fixture server/);assert.match(html,/Review domain/);assert.match(html,/Reconnect/);assert.match(html,/server enrollment service/);assert.doesNotMatch(html,/not implemented/);
});
test('Usage renders actual totals and pricing note separately from spend controls',()=>{
 const html=draw(<Usage/>,{'console.usage':{rows:[{key:'usr_1',name:'Fixture person',turns:4,tokensIn:125,tokensOut:50,costMicros:2500}],note:'Fixture beta pricing'}});
 assert.match(html,/Fixture person/);assert.match(html,/125/);assert.match(html,/50/);assert.match(html,/0.0025/);assert.match(html,/Fixture beta pricing/);assert.doesNotMatch(html,/not implemented/);
});
test('Speed renders units and direction correctly and never equates missing samples with healthy',()=>{
 const html=draw(<Speed/>,{'console.speed':{rows:[{budgetId:'startup',unit:'ms',sense:'max',p50:50,p95:1500,budgetP95:1000,worstTraceId:'a'.repeat(32),over:true}]}});
 assert.match(html,/1500 ms/);assert.match(html,/Outside budget/);assert.match(html,/Worst trace/);
 assert.equal(speedValue('ms',42),'42 ms');
 assert.match(draw(<Speed/>,{'console.speed':{rows:[]}}),/No speed samples/);
});

test('actual Console routes select Network, Speed and Usage components',()=>{assert.equal(consolePageFor('network',{}).type,Network);assert.equal(consolePageFor('speed',{}).type,Speed);assert.equal(consolePageFor('usage',{}).type,Usage);});
