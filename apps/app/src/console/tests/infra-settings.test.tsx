import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConsoleDataProvider} from '../shell/data.tsx';
import {createSampleConsole} from '../shell/sample.ts';
import {Updates,SpaceProfile} from '../pages/InfrastructureSettings.tsx';
const draw=(element:React.ReactElement,rows:Record<string,unknown>):string=>{const base=createSampleConsole().data;return renderToStaticMarkup(<ConsoleDataProvider value={{...base,screens:{...base.screens,capQuery:(cap:string)=>{const value={status:'ready',data:rows[cap]};return{subscribe:()=>()=>undefined,getSnapshot:()=>value};}} as never}}>{element}</ConsoleDataProvider>);};
test('Updates shows observed version and failure, review action and history without claiming success',()=>{
 const html=draw(<Updates/>,{'updates.status':{current:'1.0.0',channel:'stable',available:'1.1.0',lastResult:'failed'},'updates.history':{updates:[{from:'0.9.0',to:'1.0.0',at:1,result:'failed',seconds:12}]}});
 assert.match(html,/1.0.0/);assert.match(html,/failed/);assert.match(html,/Review update/);assert.match(html,/Check for updates/);assert.doesNotMatch(html,/Update completed/);
});
test('Space profile displays actual fingerprint and profile actions',()=>{
 const html=draw(<SpaceProfile/>,{'spaces.get':{space:{id:'spc_fixture',name:'Fixture Team',legalName:'Fixture Legal',owner:'usr_other',kind:'team',fingerprint:'ab12 cd34',address:{mode:'relay',host:'fixture.vyre.test'},defaults:{},createdAt:1}}});
 assert.match(html,/ab12 cd34/);assert.match(html,/fixture.vyre.test/);assert.match(html,/Save profile/);assert.doesNotMatch(html,/Delete this Space/);
});
