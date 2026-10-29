import test from 'node:test';import assert from 'node:assert/strict';import{renderToStaticMarkup}from'react-dom/server';
import{signInInvite}from'./SessionGate.tsx';import{githubStartUrl,takeGithubReturn}from'./github.ts';
import{SignIn}from'../../join/SignIn.tsx';import{JoinFrame}from'../../join/kit.tsx';import{initialState}from'../../join/logic.ts';
import type{SignInOptions}from'./stored.ts';
// The answer a booted daemon gives for identity.sign_in_options (host/tests/github-signin.live.test.ts): GitHub on, SSO empty.
const answer:SignInOptions={name:'Northwind',fingerprint:'ab12 cd34',password:true,github:true,sso:[],secondFactorRequired:false};
const screen=(options:SignInOptions|null)=>{const invite=signInInvite('http://northwind.example:3000',options);return renderToStaticMarkup(<JoinFrame><SignIn invite={invite} state={initialState(invite,{stage:'signin'})} dispatch={()=>undefined} onSubmit={()=>undefined} onGithub={()=>undefined}/></JoinFrame>);};
test('the sign-in screen offers GitHub when the Space says it is on, and not before it has answered or when it is off',()=>{
 assert.equal(signInInvite('http://northwind.example:3000',answer).github,true);
 assert.ok(screen(answer).includes('data-testid="github"'));assert.ok(screen(answer).includes('data-testid="sign-in-github"'));
 assert.ok(!screen({...answer,github:false}).includes('data-testid="github"'));
 assert.ok(!screen(null).includes('data-testid="github"'));
});
test('SSO stays off: the Space lists no provider and identity.sso_sign_in answers validation.unsupported',()=>{
 assert.deepEqual(signInInvite('http://northwind.example',answer).sso,[]);assert.ok(!screen(answer).includes('data-testid="sign-in-sso"'));
});
test('the GitHub button leads to the Space start route and back to this page; the code is taken from the fragment once',()=>{
 assert.equal(githubStartUrl('https://space.example/','https://app.example/home'),'https://space.example/auth/github/start?return=https%3A%2F%2Fapp.example%2Fhome');
 let replaced='';const loc={hash:'#github_code=stub-code-1',pathname:'/home',search:'?a=1'};
 assert.deepEqual(takeGithubReturn(loc,u=>{replaced=u;}),{code:'stub-code-1'});assert.equal(replaced,'/home?a=1','the code leaves the address bar');
 assert.deepEqual(takeGithubReturn({...loc,hash:'#github_error=denied'},()=>undefined),{error:true});
 assert.equal(takeGithubReturn({...loc,hash:'#other=1'},()=>{throw new Error('untouched');}),null);assert.equal(takeGithubReturn(undefined,()=>undefined),null);
});
