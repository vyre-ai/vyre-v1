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
  sink.span({trace_id:'trace',span_id:'span',parent:null,name:'accepted',at:1,dur_us:2});
  sink.close();
  assert.doesNotThrow(()=>sink.log({space:'spc_test',level:20,msg:'late'}));
  assert.doesNotThrow(()=>sink.span({trace_id:'late',span_id:'late',parent:null,name:'late',at:2,dur_us:2}));
  assert.doesNotThrow(()=>sink.flush());
  assert.doesNotThrow(()=>sink.close());
  await new Promise(resolve=>setTimeout(resolve,15));
  const db=new DatabaseSync(file);
  assert.deepEqual(db.prepare('SELECT msg FROM logs').all().map(row=>row.msg),['accepted']);
  assert.deepEqual(db.prepare('SELECT name FROM spans').all().map(row=>row.name),['accepted']);
  db.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});
