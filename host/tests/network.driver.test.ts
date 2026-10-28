import test from 'node:test';
import assert from 'node:assert/strict';
import { managedNetworkPort } from '../src/daemon/network-driver.ts';
import { FakeCaddy } from '../src/caddy/fake.ts';
import { routeId } from '../src/caddy/index.ts';
test('managed own domain writes a real Caddy route to the fixed local gateway and fails when Caddy refuses',async()=>{
 const caddy=new FakeCaddy();const port=managedNetworkPort({adminUrl:'http://127.0.0.1:2019',space:'spc_fixture',upstream:()=> '127.0.0.1:8420',ingressHost:()=> 'fixture.example.com',relayReady:()=>false,fetch:caddy.fetch});
 await port.applyAddress({mode:'own_domain',address:'fixture.example.com'});
 assert.ok(caddy.calls.some(call=>JSON.stringify(call.body ?? null).includes(routeId('fixture.example.com'))));
 assert.ok(caddy.calls.some(call=>JSON.stringify(call.body ?? null).includes('127.0.0.1:8420')));
 caddy.down=true;await assert.rejects(port.applyAddress({mode:'own_domain',address:'other.example.com'}),/Caddy/);
});
test('relay requires this Space active endpoint and unavailable compute operations fail',async()=>{
 const port=managedNetworkPort({adminUrl:'http://127.0.0.1:2019',space:'spc_fixture',upstream:()=> '127.0.0.1:8420',ingressHost:()=> 'fixture.example.com',relayReady:address=>address==='connected.example.com'});
 await assert.rejects(port.applyAddress({mode:'relay',address:'unconnected.example.com'}),/no active endpoint/);
 await port.applyAddress({mode:'relay',address:'connected.example.com'});
 await assert.rejects(port.reconnect('srv_fixture'),/no server connection manager/);
 await assert.rejects(port.disconnect('srv_fixture'),/no server connection manager/);
});
test('certificate renewal observes actual certificate and does not invent issuance',async()=>{
 const ingress:string[]=[];let issued=false;const port=managedNetworkPort({adminUrl:'http://127.0.0.1:2019',space:'spc_fixture',upstream:()=> '127.0.0.1:8420',ingressHost:()=> 'fixture.example.com',relayReady:()=>false,router:{setIngress:async(host)=>{ingress.push(host);},certInfo:async()=>issued?{issued:true,expiresAt:9000}:{issued:false,why:'Fixture ACME pending'}}});
 assert.deepEqual(await port.renew('fixture.example.com'),{expiresAt:null,reason:'Fixture ACME pending'});issued=true;
 assert.deepEqual(await port.renew('fixture.example.com'),{expiresAt:9000});assert.equal(ingress.length,2);await assert.rejects(port.renew('private-site.example.com'),/Only the current Space ingress/);assert.equal(ingress.length,2,'renewal never overwrites unrelated route authentication or upstream');
});
