import test from 'node:test';import assert from 'node:assert/strict';
import{commaValues,safeProviderUrl}from'../pages/integration-data.ts';
test('provider handoff accepts only an actual secure address without embedded credentials',()=>{assert.equal(safeProviderUrl('https://accounts.example/authorize?state=fixture'),'https://accounts.example/authorize?state=fixture');for(const value of ['javascript:alert(1)','http://accounts.example','https://user:password@accounts.example','not a URL'])assert.throws(()=>safeProviderUrl(value));});
test('scope and event names preserve spelling while excluding duplicate and empty choices',()=>{assert.deepEqual(commaValues('read, ,post,read, record.*'),['read','post','record.*']);});
