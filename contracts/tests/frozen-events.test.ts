// @reads /generated/registry.json
// @reads /docs/frozen/snapshots
// Freeze of the event catalogue (ARCH 3.3, spec 2.22, AC24).
// A name is <primitive>.<verb>. Every event has an owner module and an object payload schema.
// vis, label, redact and sv are checked here. Each event is frozen in docs/frozen/snapshots/<manifest>.json (lib/snapshot.ts), not by one hash of the whole catalogue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SNAPSHOT_DIR, snapshotDrift } from '../../lib/snapshot.ts';

const NAME_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const VIS = new Set(['space', 'participants', 'owner', 'private']);
const LABELS = new Set(['public', 'internal', 'confidential', 'restricted', 'subject']);
const REPLAY = new Set(['pure', 'stub']);

interface Schema {
  type?: string | string[];
  properties?: Record<string, Schema>;
  $ref?: string;
}

interface CatalogueEvent {
  name: string;
  module: string;
  sv: number;
  summary: string;
  vis: string;
  label?: string;
  redact?: string[];
  replay: string;
  payload: Schema;
  subject: { type: string; id: string };
}

interface Catalogue {
  events: CatalogueEvent[];
  modules: Set<string>;
  defs: Record<string, Schema>;
}

function load(): Catalogue {
  const raw = JSON.parse(readFileSync(new URL('../../generated/registry.json', import.meta.url), 'utf8')) as {
    $defs?: Record<string, Schema>;
    modules: Array<{ id: string }>;
    events: CatalogueEvent[];
  };
  return { events: raw.events, modules: new Set(raw.modules.map((m) => m.id)), defs: raw.$defs ?? {} };
}

function deref(schema: Schema, defs: Record<string, Schema>): Schema {
  let cur = schema;
  for (let i = 0; cur.$ref && i < 20; i++) {
    const name = cur.$ref.slice('#/$defs/'.length);
    const next = defs[name];
    if (!next) throw new Error(`unresolved $ref ${cur.$ref}`);
    cur = next;
  }
  return cur;
}

/** Resolve a JSON pointer to a payload property. Same walk as pointerSchema in packages/contracts. */
function pointerSchema(schema: Schema, pointer: string, defs: Record<string, Schema>): Schema | undefined {
  if (!pointer.startsWith('/')) return undefined;
  let cur: Schema | undefined = schema;
  for (const part of pointer.slice(1).split('/')) {
    if (!cur) return undefined;
    cur = deref(cur, defs);
    const props = cur.properties;
    if (!props || !Object.hasOwn(props, part)) return undefined;
    cur = props[part];
  }
  return cur;
}

const catalogue = load();

test('every event matches its snapshot, and no snapshot is missing or stray', () => {
  const root = new URL('../../', import.meta.url);
  const raw = JSON.parse(readFileSync(new URL('generated/registry.json', root), 'utf8')) as Parameters<typeof snapshotDrift>[0];
  const have = new Map<string, string>();
  for (const name of readdirSync(new URL(`${SNAPSHOT_DIR}/`, root))) have.set(`${SNAPSHOT_DIR}/${name}`, readFileSync(new URL(`${SNAPSHOT_DIR}/${name}`, root), 'utf8'));
  assert.deepEqual(snapshotDrift(raw, have), [], 'a contract changed without its snapshot: the regen bot writes them (node tools/gen/src/cli.ts --snapshots)');
});

test('event names match <primitive>.<verb> and are unique', () => {
  const seen = new Set<string>();
  for (const event of catalogue.events) {
    assert.match(event.name, NAME_RE, event.name);
    assert.equal(seen.has(event.name), false, event.name);
    seen.add(event.name);
  }
});

test('every event has an owner module and an object payload schema', () => {
  for (const event of catalogue.events) {
    assert.equal(typeof event.module, 'string', event.name);
    assert.ok(catalogue.modules.has(event.module), `${event.name} module ${event.module}`);
    const payload = deref(event.payload, catalogue.defs);
    assert.equal(payload.type, 'object', event.name);
    assert.ok(payload.properties && Object.keys(payload.properties).length > 0, event.name);
    assert.equal(typeof event.subject.id, 'string', event.name);
    assert.ok(pointerSchema(event.payload, event.subject.id, catalogue.defs), `${event.name} subject ${event.subject.id}`);
  }
});

test('every event has vis, label, redact and sv within the catalogue rules', () => {
  for (const event of catalogue.events) {
    assert.ok(VIS.has(event.vis), `${event.name} vis ${event.vis}`);
    if (event.label !== undefined) assert.ok(LABELS.has(event.label), `${event.name} label ${event.label}`);
    assert.ok(Number.isInteger(event.sv) && event.sv >= 1, `${event.name} sv ${event.sv}`);
    assert.ok(REPLAY.has(event.replay), `${event.name} replay ${event.replay}`);
    for (const pointer of event.redact ?? []) {
      assert.equal(typeof pointer, 'string', event.name);
      assert.ok(pointerSchema(event.payload, pointer, catalogue.defs), `${event.name} redact ${pointer}`);
    }
  }
});
