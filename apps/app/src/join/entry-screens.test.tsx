import test from 'node:test';import assert from 'node:assert/strict';import{renderToStaticMarkup}from'react-dom/server';
import{SpaceEntry}from'./SpaceEntry.tsx';import{JoinFrame}from'./kit.tsx';import{SignIn}from'./SignIn.tsx';import{initialState}from'./logic.ts';
const invite={space:'Northwind',host:'northwind.example',by:'Owner',role:'Member',sso:[],github:false,adminKey:false};
test('Space entry uses the shared0.6.8 auth frame and exposes distinct real join/create choices',()=>{
 const html=renderToStaticMarkup(<SpaceEntry onTarget={()=>undefined} onBack={()=>undefined}/>);
 for(const id of['join-frame','join-panel','auth-form-mark','space-entry-join','space-entry-create'])assert.ok(html.includes(`data-testid="${id}"`),id);
 assert.ok(!html.includes('Created your Space'));assert.ok(html.includes('Join a Space') && html.includes('Create a Space'));
});
test('locked entry keeps password sign-in and has an explicit Unlock action without device approval',()=>{
 const html=renderToStaticMarkup(<JoinFrame><SignIn invite={invite} state={initialState(invite,{stage:'signin'})} dispatch={()=>undefined} unlock onSubmit={()=>undefined} onBack={()=>undefined}/></JoinFrame>);
 assert.ok(html.includes('Unlock Vyre'));assert.ok(html.includes('Unlock'));assert.ok(html.includes('data-testid="si-password"'));assert.ok(html.includes('data-testid="back"'));assert.doesNotMatch(html,/Touch ID|approve on your phone|passkey/i);
});
test('on the desktop app for a Mac the Team Space choice offers to run this Mac as the server; elsewhere it does not',async()=>{
 const{MacServerOffer}=await import('./SpaceEntry.tsx');const{isMacShell}=await import('../shell/session/entry.ts');
 const html=renderToStaticMarkup(<JoinFrame><MacServerOffer busy={false} onPress={()=>undefined}/></JoinFrame>);
 assert.ok(html.includes('data-testid="create-mac-server"'));assert.ok(html.includes('Run this Mac as the Space server'));assert.ok(html.includes('relay'));
 assert.ok(renderToStaticMarkup(<JoinFrame><MacServerOffer busy onPress={()=>undefined}/></JoinFrame>).includes('Starting the server'));
 assert.equal(isMacShell({platform:'MacIntel',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'}),true);
 assert.equal(isMacShell({platform:'iPhone',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'}),false);
 assert.equal(isMacShell({platform:'Win32',userAgent:'Mozilla/5.0 (Windows NT 10.0)'}),false);
 assert.equal(isMacShell({}),false);
});
