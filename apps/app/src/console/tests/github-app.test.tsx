import test from "node:test";
import assert from "node:assert/strict";
import {renderToStaticMarkup} from "react-dom/server";
import {GithubAppView} from "../pages/Policies.tsx";
const base={secretSet:false,source:"none" as const,callbackUrl:"https://space.example/auth/github/callback",createUrl:"https://github.com/settings/applications/new?oauth_application%5Bcallback_url%5D=https%3A%2F%2Fspace.example%2Fauth%2Fgithub%2Fcallback"};
test("the GitHub app section shows the callback to register, the create link and the client id and secret fields for an admin",()=>{
 const html=renderToStaticMarkup(<GithubAppView github={base} editing/>);
 assert.ok(html.includes("https://space.example/auth/github/callback"));
 for(const id of ["github-copy-callback","github-create-app","github-client-id","github-client-secret","github-save"])assert.ok(html.includes(`data-testid="${id}"`),id);
 assert.ok(html.includes("Not set"));assert.ok(!html.includes('data-testid="github-clear"'));
});
test("once the secret is set the page says only that it is set, keeps it in the Vault, and never has a value to show",()=>{
 const html=renderToStaticMarkup(<GithubAppView github={{...base,clientId:"Iv1.stubclient0001",secretSet:true,source:"space"}} editing/>);
 assert.ok(html.includes("Iv1.stubclient0001"));assert.ok(html.includes("Set, kept in the Vault"));assert.ok(html.includes("New client secret (leave empty to keep the saved one)"));
 assert.ok(html.includes('data-testid="github-clear"'));assert.doesNotMatch(html,/value="[^"]*secret/i);
});
test("outside editing there are no fields, and a server environment app is named as the one in use",()=>{
 const html=renderToStaticMarkup(<GithubAppView github={{...base,clientId:"Iv1.fromenv00001",secretSet:true,source:"env"}}/>);
 assert.ok(!html.includes('data-testid="github-client-secret"'));assert.ok(html.includes("takes priority"));
});
