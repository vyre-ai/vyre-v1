// The generated DDL runs on SQLite (node:sqlite), and each seed loads on top of the replica DDL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const gen = (p: string) => readFileSync(new URL(`../../../generated/${p}`, import.meta.url), 'utf8');
const dir = fileURLToPath(new URL('../../../generated/modules/', import.meta.url));

test('replica.sql creates every table', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(gen('sync/replica.sql'));
  const n = (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
  assert.ok(n > 60, `tables: ${n}`);
  db.close();
});

test('each module schema.sql runs on its own', () => {
  let ran = 0;
  for (const m of readdirSync(dir)) {
    const f = `${dir}${m}/schema.sql`;
    if (!existsSync(f)) continue;
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(f, 'utf8'));
    db.close();
    ran++;
  }
  assert.ok(ran > 20, `schema files: ${ran}`);
});

for (const space of ['team', 'harbor', 'personal']) {
  test(`seed ${space} loads on the replica DDL`, () => {
    const db = new DatabaseSync(':memory:');
    db.exec(gen('sync/replica.sql'));
    db.exec(gen(`seed/${space}.sql`));
    const roles = (db.prepare('SELECT count(*) AS n FROM access_roles').get() as { n: number }).n;
    const people = (db.prepare("SELECT count(*) AS n FROM access_principals WHERE kind = 'person'").get() as { n: number }).n;
    assert.equal(roles, 5);
    assert.ok(people >= 1);
    db.close();
  });
}
// run id of the last green push is linked from the tracker packet P-PR_10
