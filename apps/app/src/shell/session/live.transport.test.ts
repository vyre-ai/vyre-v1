import test from 'node:test';
import assert from 'node:assert/strict';
import {webSocketDial} from './live.ts';
import {endpoint} from '../../../../../client/src/connection/index.ts';

test('a connected socket transfers close ownership to its transport; canceling the completed dial keeps the winner open',async()=>{
 const previous=globalThis.WebSocket;const sockets:Socket[]=[];
 class Socket{onopen:(()=>void)|null=null;onmessage:((event:{data:unknown})=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;closed=false;url:string;constructor(url:string){this.url=url;sockets.push(this);}send(){}close(){this.closed=true;this.onclose?.();}}
 Object.assign(globalThis,{WebSocket:Socket});
 try{const abort=new AbortController();const pending=webSocketDial(()=> 'fixture-token')(endpoint('direct','ws://127.0.0.1:8420'),abort.signal);assert.equal(sockets[0]!.url,'ws://127.0.0.1:8420/sync/v1/ws?token=fixture-token');sockets[0]!.onopen?.();const transport=await pending;abort.abort();assert.equal(sockets[0]!.closed,false);transport.close('leaving Space');assert.equal(sockets[0]!.closed,true);
 const canceled=new AbortController();const connecting=webSocketDial(()=> 'fixture-token')(endpoint('direct','ws://127.0.0.1:8420'),canceled.signal);const refusal=assert.rejects(connecting,/closed before it opened/);canceled.abort();await refusal;assert.equal(sockets[1]!.closed,true);
 }finally{Object.assign(globalThis,{WebSocket:previous});}
});
