import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeBrowserInvite, inviteAppLink, entryTarget, lockedIdentity } from './entry.ts';

test('Space entry accepts canonical invite and claim links without treating them as plain sign-in addresses',()=>{
 assert.deepEqual(entryTarget('https://team.example/join/ABCD-EFGH#fp=ab12cd34'),{kind:'join',address:'https://team.example',code:'ABCD-EFGH',fingerprint:'ab12cd34'});
 assert.deepEqual(entryTarget('team.example'),{kind:'signin',address:'https://team.example'});
 assert.equal(entryTarget('https://team.example/claim/abcdefghijklmnopqrstuvwxyz#s=spc_fixture')?.kind,'claim');
 for(const input of ['https://user:password@team.example','javascript:alert(1)','javascript:/join/ABCD-EFGH#fp=ab12cd34','file:///join/ABCD-EFGH#fp=ab12cd34','https://team.example/join/ABCD-EFGH','https://team.example/unknown','https://team.example/join/ABCD-EFGH#fp=%00'])assert.equal(entryTarget(input),null,input);
});
test('Lock marker carries display identity only and cannot retain a bearer or password',()=>{
 const marker=lockedIdentity({baseUrl:'https://team.example',personId:'usr_owner',token:'private',password:'never',name:'Owner'});
 assert.deepEqual(marker,{address:'https://team.example',personId:'usr_owner',name:'Owner'});
 assert.ok(!JSON.stringify(marker).includes('private'));assert.ok(!JSON.stringify(marker).includes('never'));
});

test('Spent browser invites leave history before the shell remounts; ordinary app links remain',()=>{const replaced:string[]=[];const history={replaceState(_data:unknown,_unused:string,url:string){replaced.push(url);}};consumeBrowserInvite({location:{pathname:'/join/ABCD-EFGH'},history});consumeBrowserInvite({location:{pathname:'/tasks'},history});assert.deepEqual(replaced,['/home']);});

test('Desktop invite handoff encodes only the existing HTTPS join protocol and keeps local web invites in the browser',()=>{const route={kind:'join' as const,address:'https://space.example',code:'ABCD-EFGH',fingerprint:'ab12cd34'};const link=new URL(inviteAppLink(route)!);assert.equal(link.protocol,'vyre:');assert.equal(link.hostname,'join');assert.deepEqual(Object.fromEntries(link.searchParams),{address:route.address,code:route.code,fp:route.fingerprint});assert.equal(inviteAppLink({...route,address:'http://127.0.0.1:8421'}),null);});
