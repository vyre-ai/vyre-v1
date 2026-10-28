import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogSink } from '../src/logsink/index.ts';

test('close flushes accepted rows and spans once, and rejects late appends without a timer', async () => {
 const dir=mkdtempSync(join(tmpdir(),'vyre-logs-close-')); const file=join(dir,'logs.db');
 try {
  const sink=new LogSink({path:file,batchMs:5});
  sink.log({space:'spc_test',level:20,msg:'accepted'});
  sink.span({trace_id:'trace',span_id:'span',parent:null,name:'accepted',at:1,dur_us:2,attrs:null});
  sink.close();
  assert.doesNotThrow(()=>sink.log({space:'spc_test',level:20,msg:'late'}));
  assert.doesNotThrow(()=>sink.span({trace_id:'late',span_id:'late',parent:null,name:'late',at:2,dur_us:2,attrs:null}));
  assert.doesNotThrow(()=>sink.flush());
  assert.doesNotThrow(()=>sink.close());
  await new Promise(resolve=>setTimeout(resolve,15));
  const db=new DatabaseSync(file);
  assert.deepEqual(db.prepare('SELECT msg FROM logs').all().map(row=>row.msg),['accepted']);
  assert.deepEqual(db.prepare('SELECT name FROM spans').all().map(row=>row.name),['accepted']);
  db.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});


test('observer batches are bounded and a failed committed batch retries without duplicating local rows',()=>{
 const sink=new LogSink({batchMs:60000});const seen:string[]=[];let fail=true;let largest=0;
 sink.setObserver(batch=>{largest=Math.max(largest,batch.rows.length);if(fail){fail=false;throw new Error('fixture observer failure');}seen.push(...batch.rows.map(row=>row.msg));});
 for(let index=0;index<2005;index++)sink.log({space:'spc_test',level:20,msg:`fixture_${index}`});
 assert.throws(()=>sink.flush(),/fixture observer failure/);assert.equal(sink.db.prepare('SELECT COUNT(*) AS n FROM logs').get()?.n,1000);
 sink.drain();assert.equal(largest,1000);assert.equal(seen.length,2005);assert.equal(new Set(seen).size,2005);assert.equal(sink.db.prepare('SELECT COUNT(*) AS n FROM logs').get()?.n,2005);sink.close();
});


test('legacy source metadata seeds monotonic positions from persisted rows and canonical checkpoints',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE log_source (id TEXT PRIMARY KEY); INSERT INTO log_source (id) VALUES ('legacy-source');");
 const sink=new LogSink({db,batchMs:60000});sink.setObserver(()=>undefined,{rowId:5000,spanId:6000});sink.log({space:'spc_test',level:20,msg:'service.state'});sink.span({trace_id:'1'.repeat(32),span_id:'1'.repeat(16),parent:null,name:'invoke',at:1,dur_us:2,attrs:null});sink.flush();
 assert.equal(sink.sourceId,'legacy-source');assert.equal(db.prepare('SELECT id FROM logs').get()?.id,5001);assert.equal(db.prepare('SELECT rowid AS id FROM spans').get()?.id,6001);sink.close();
});
