// search (lane L1): server half of Cmd-K and the one index (spec 3.0, b11; ARCHITECTURE-V1.md 4.3 consumers search.fts and search.vectors, section 9).
// The device runs its own FTS5 over the replica; the client merges local hits with these server hits (server within 300 ms).
// Private chats, personal memory and Mine vault items are end-to-end and never in this index.
// DECISION: the query is one capability with a prefix and type filters; the prefixes @ # / > are parsed by the client, which sends `types`.
import { defineManifest, ev, health, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, label, pageIn, pageOut } from './_common.ts';

const kind = t.enm('person', 'agent', 'chat', 'inbox', 'record', 'file', 'automation', 'app', 'setting', 'memory', 'task', 'channel');
const hit = t.obj({
  kind, id: t.str({ examples: ['rec_a1b2c3'] }), title: t.str(), snippet: t.opt(t.str()), path: t.opt(t.str()),
  link: t.str({ description: 'Source link that opens through the place', examples: ['vyre://record/rec_a1b2c3'] }),
  label: t.opt(label), score: t.num(), updatedAt: t.opt(t.ts()),
});
const action = t.obj({ key: t.str({ examples: ['task.new'] }), title: t.str({ examples: ['New task'] }), icon: t.str(), cap: t.opt(t.str()), keys: t.opt(t.str()) });

export default defineManifest({
  id: 'search',
  title: 'Search',
  owner: 'L1',
  capabilities: [
    read('search.query', 'Search everything the caller may see: people, agents, chats, inbox, records, files, automations, apps, settings, memory', {
      in: {
        q: t.str(), types: t.opt(t.arr(kind)), mode: t.opt(t.enm('keyword', 'semantic', 'hybrid')), folderId: t.opt(id.folder),
        recordType: t.opt(id.recordType), ...pageIn,
      },
      out: { hits: t.arr(hit), tookMs: t.int(), ...pageOut }, label: 'filter', tool: 'meta', cli: 'vyre search',
      rate: { n: 120, perSeconds: 60, scope: 'principal' },
    }),
    read('search.recent.list', 'Recent items before typing (opened and edited by the caller)', {
      in: { types: t.opt(t.arr(kind)), limit: t.opt(t.int({ minimum: 1, maximum: 50 })) }, out: { hits: t.arr(hit) }, label: 'filter', tool: 'meta',
    }),
    write('search.recent.record', 'Note that the caller opened something so it shows under Recent', {
      in: { kind, itemId: t.str() }, out: { ok: t.bool() }, tool: 'meta', offline: 'queue', idem: 'none', risk: 'low',
    }),
    read('search.actions.list', 'Actions offered after the > prefix (New task, Call someone, Switch skin, Set yourself away, Go offline)', {
      in: { q: t.opt(t.str()) }, out: { actions: t.arr(action) }, tool: 'meta',
    }),
    read('search.related', 'Items related to one item by links, relations and shared terms', {
      in: { kind, itemId: t.str(), limit: t.opt(t.int({ minimum: 1, maximum: 50 })) }, out: { hits: t.arr(hit) }, label: 'filter', tool: 'meta',
    }),
    write('search.index.apply', 'Index consumer: apply one changed entity row to full text and vectors (durable cursor; never sees end-to-end rows)', {
      in: { entity: t.str(), id: t.str(), op: t.enm('upsert', 'delete'), seq: t.int({ minimum: 0 }) },
      out: { indexed: t.bool() }, idem: 'natural', risk: 'low',
    }),
    write('search.embed.run', 'Embeddings consumer: compute pending vectors with the small local model (384 dimensions)', {
      in: { limit: t.opt(t.int({ minimum: 1, maximum: 1000 })) }, out: { embedded: t.int(), pending: t.int() }, idem: 'none', risk: 'low',
    }),
    write('search.index.rebuild', 'Rebuild the index for an entity or the whole Space from the projections', {
      in: { entity: t.opt(t.str()) }, out: { runId: id.run }, emits: ['search.reindexed'], run: { kind: 'search_rebuild', stoppable: true },
      perm: 'server.services', level: 'manage', risk: 'medium', audit: 'always', tool: 'engineer', idem: 'none',
    }),
    read('search.index.stats', 'Index size, consumer lag and vector backlog', {
      out: { documents: t.int(), vectors: t.int(), ftsLagSeq: t.int(), vectorBacklog: t.int(), lastRebuildAt: t.opt(t.ts()) }, perm: null, level: 'manage', tool: 'engineer',
    }),
    read('search.health', 'Search health: consumer lag and a probe query latency', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) },
    }),
  ],
  events: [
    ev('search.reindexed', 'The search index was rebuilt', { p: { entity: t.opt(t.str()), documents: t.int(), runId: id.run }, subject: ['run', '/runId'], vis: 'space' }),
  ],
  health: [
    health('search', 'Search index', 'search.health', 'Open Console > Infrastructure > Health and rebuild the index'),
  ],
  screens: [
    screen('shell.cmdk', 'shell', 'ui:CmdK', {
      slot: 'sheet',
      q: { hits: ['search.query', { q: '/query/q', types: '/query/types', mode: '/query/mode' }, false], recent: ['search.recent.list', {}, false], actions: ['search.actions.list', { q: '/query/q' }, false] },
      a: { opened: ['search.recent.record', { kind: '/hit/kind', itemId: '/hit/id' }] },
      empty: 'No results', primary: 'Clear search', perf: { firstPaintMs: 50, completeMs: 300 },
    }),
    screen('shell.new-tab', 'shell', 'ui:NewTabSearch', {
      slot: 'tab',
      q: { hits: ['search.query', { q: '/query/q', types: '/query/types', mode: '/query/mode' }, false], recent: ['search.recent.list', {}, false], actions: ['search.actions.list', { q: '/query/q' }, false] },
      a: { opened: ['search.recent.record', { kind: '/hit/kind', itemId: '/hit/id' }] },
      empty: 'Open anything, or start something', primary: 'Start', keys: [{ combo: 'Cmd-T', action: 'open' }],
    }),
  ],
});
