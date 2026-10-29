import test from 'node:test';import assert from 'node:assert/strict';
import {syncEndpointOrigin} from './sync-endpoint.ts';
test('advertised live endpoints are WebSocket origins with the configured explicit port',()=>{
 assert.equal(syncEndpointOrigin('space.fixture.invalid:8443'),'wss://space.fixture.invalid:8443');
 assert.equal(syncEndpointOrigin('https://space.fixture.invalid:8443/'),'wss://space.fixture.invalid:8443');
 assert.equal(syncEndpointOrigin('http://127.0.0.1:8420'),'ws://127.0.0.1:8420');
 assert.equal(syncEndpointOrigin('http://localhost:8420/'),'ws://localhost:8420');
 assert.equal(syncEndpointOrigin('http://[::1]:8420/'),'ws://[::1]:8420');
 for(const value of ['http://space.fixture.invalid','http://localhost.evil.invalid:80','https://user:password@space.fixture.invalid','javascript:alert(1)','ws://127.0.0.1:8420','https://'])assert.equal(syncEndpointOrigin(value),null,value);
});
