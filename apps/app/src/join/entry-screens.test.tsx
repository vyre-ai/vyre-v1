import test from 'node:test';import assert from 'node:assert/strict';import{renderToStaticMarkup}from'react-dom/server';
import{SpaceEntry}from'./SpaceEntry.tsx';import{JoinFrame}from'./kit.tsx';import{SignIn}from'./SignIn.tsx';import{initialState}from'./logic.ts';
const invite={space:'Northwind',host:'northwind.example',by:'Owner',role:'Member',sso:[],github:false,adminKey:false};
test('Space entry uses the shared0.6.8 auth frame and exposes distinct real join/create choices',()=>{
 const html=renderToStaticMarkup(<SpaceEntry onTarget={()=>undefined} onBack={()=>undefined}/>);
 for(const id of['join-frame','join-panel','auth-form-mark','space-entry-join','space-entry-create'])assert.ok(html.includes(`data-testid="${id}"`),id);
 assert.ok(html.includes('Join your team, or make a place of your own.'));assert.ok(!html.includes('Created your Space'));
});
test('locked entry keeps password sign-in and has an explicit Unlock action without device approval',()=>{
 const html=renderToStaticMarkup(<JoinFrame><SignIn invite={invite} state={initialState(invite,{stage:'signin'})} dispatch={()=>undefined} unlock onSubmit={()=>undefined} onBack={()=>undefined}/></JoinFrame>);
 assert.ok(html.includes('Unlock Vyre'));assert.ok(html.includes('Unlock'));assert.ok(html.includes('data-testid="si-password"'));assert.ok(html.includes('data-testid="back"'));assert.doesNotMatch(html,/Touch ID|approve on your phone|passkey/i);
});
