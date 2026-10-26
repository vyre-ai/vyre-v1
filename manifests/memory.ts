// memory (lane L2): layers, bi-temporal facts, capture, promotion, pointer lookup and the graph.
// Sources: ARCHITECTURE-V1.md 6.10 and 7.5 (memory graph); spec 2.15, 4.15, 3.5 (Knowledge: Memory, Graph).
// Notes are Markdown files owned by Files; facts are rows here. Engines' own memory is off: one memory.
// DECISION: layer access is decided inside the handler by authorize on the layer folder resource (People/<person>/memory/<agent>/ for the
//   person layer, Agents/<agent>/memory/ for the agent layer, project and Space folders for the others); capabilities that take a
//   layer are therefore bound to the Space resource, not to one pointer.
// DECISION: the spec names "low-risk fact kinds" without listing them; the setting memory.auto_merge_kinds defaults to preferences only.
// DECISION: memory_saved block actions are limited to Propose for team; correcting or removing needs a fact id array, which a block cannot pass.
// NOT EXPRESSIBLE: person-layer rows are end-to-end (enc=2) per row while the same entity also holds shared layers; EntityDef e2e is per entity, so it stays 'none'.
import { block, create, defineManifest, entity, ev, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, versionRow } from './_common.ts';

const layer = t.enm('person', 'agent', 'project', 'space');
const factStatus = t.enm('proposed', 'current', 'closed', 'removed');
const sourceKind = t.enm('chat', 'channel', 'task', 'record', 'run', 'journey', 'manual');
const factRow = t.obj({
  factId: id.fact, layer, ownerRef: t.str({ description: 'Person, agent, project or Space the fact belongs to', examples: ['agt_a1b2c3'] }), agentId: t.opt(id.agent), noteId: t.opt(id.note),
  text: t.str(), validFrom: t.ts(), validTo: t.opt(t.ts()), learnedAt: t.ts(), closedAt: t.opt(t.ts()), sourceKind, sourceRef: t.str(),
  sourceLink: t.opt(t.str({ description: 'Link to the exact chat, task or record' })), status: factStatus, lowRisk: t.opt(t.bool()),
});
const noteRow = t.obj({ noteId: id.note, path: t.str({ examples: ['Agents/Intake/memory/notes/clients.md'] }), title: t.str(), layer, agentId: t.opt(id.agent), updatedAt: t.ts() });
const hit = t.obj({ kind: t.enm('note', 'fact'), noteId: t.opt(id.note), factId: t.opt(id.fact), title: t.str(), text: t.str(), path: t.opt(t.str()), trueSince: t.opt(t.ts()), layer, sourceLink: t.opt(t.str()), score: t.num() });
const node = t.obj({
  nodeId: t.str(), kind: t.enm('note', 'person', 'client', 'project', 'site', 'decision', 'record', 'chat'), title: t.str(), layer: t.opt(layer), cluster: t.opt(t.str({ description: 'Cluster named after its hub' })),
  x: t.opt(t.num()), y: t.opt(t.num()), link: t.opt(t.str()),
});
const edge = t.obj({ from: t.str(), to: t.str(), kind: t.enm('link', 'relation', 'came_from') });
const graphScope = t.enm('agent', 'space');
const graphIn = { scope: graphScope, agentId: t.opt(id.agent), asOf: t.opt(t.ts()), kinds: t.opt(t.arr(t.str())) };
const graphOut = { nodes: t.arr(node), edges: t.arr(edge), clusters: t.arr(t.obj({ name: t.str(), hub: t.str(), size: t.int() })) };
const factT = { factId: id.fact };
const promotionId = t.id('prm');

export default defineManifest({
  id: 'memory',
  title: 'Memory',
  owner: 'L2',
  entities: [
    entity('fact', 'memory_fact', 'fct_', {
      layer: 'choice', ownerRef: 'text', noteId: 'text', text: 'text', validFrom: 'datetime', validTo: 'datetime', learnedAt: 'datetime', closedAt: 'datetime',
      sourceKind: 'choice', sourceRef: 'text', status: 'status',
    }, 'folder', { fts: ['text'], sync: { window: { recentCount: 2000 }, protectedFields: ['status'] } }),
  ],
  capabilities: [
    // ---- erase and purge (P-CC_39)
    write('memory.notes.erase', 'Erase one memory note for good, with its graph node and links (governance erase)', { level: 'manage', perm: 'policy.manage', idem: 'key', in: { noteId: id.note }, out: { erased: t.bool() }, emits: ['note.erased'], audit: 'always', risk: 'high' }),
    // ---- read tools
    read('memory.search', 'Search notes and current facts the asker may read; BM25, vectors and recency; snippets carry the source link', {
      in: { q: t.str(), layers: t.opt(t.arr(layer)), agentId: t.opt(id.agent), projectId: t.opt(id.project), mode: t.opt(t.enm('keyword', 'semantic', 'hybrid')), limit: t.opt(t.int({ minimum: 1, maximum: 50 })) },
      out: { hits: t.arr(hit), tookMs: t.int() }, label: 'filter', tool: 'memory', mcpName: 'memory_search', agent: { planMode: 'allowed' }, cli: 'vyre memory search',
    }),
    read('memory.read_note', 'Read one memory note as Markdown', {
      in: { noteId: id.note }, out: { note: noteRow, markdown: t.str() }, on: ['note', '/noteId'], label: 'check', tool: 'memory', mcpName: 'read_note', agent: { planMode: 'allowed' },
    }),
    read('memory.facts_as_of', 'Facts that were true on a date (valid_from and valid_to), for "what did it believe on 3 March"', {
      in: { date: t.ts(), agentId: t.opt(id.agent), layer: t.opt(layer), q: t.opt(t.str()), ...pageIn }, out: { facts: t.arr(factRow), ...pageOut },
      label: 'filter', tool: 'memory', mcpName: 'facts_as_of', agent: { planMode: 'allowed' },
    }),
    read('memory.facts.list', 'List facts by layer, agent, status or "From you"; proposed facts wait here for acceptance', {
      in: { layer: t.opt(layer), agentId: t.opt(id.agent), projectId: t.opt(id.project), status: t.opt(t.arr(factStatus)), fromMe: t.opt(t.bool()), q: t.opt(t.str()), ...pageIn },
      out: { facts: t.arr(factRow), ...pageOut }, label: 'filter', tool: 'memory',
    }),
    read('memory.fact.get', 'Read one fact with its history of closed versions', {
      in: factT, out: { fact: factRow, history: t.arr(factRow) }, label: 'check', tool: 'memory', errors: ['validation.not_found'],
    }),
    read('memory.notes.list', 'List memory notes of an agent, project or the Space, including proposed/ and recipes/', {
      in: { agentId: t.opt(id.agent), projectId: t.opt(id.project), layer: t.opt(layer), area: t.opt(t.enm('notes', 'proposed', 'recipes', 'journal')), ...pageIn },
      out: { notes: t.arr(noteRow), ...pageOut }, label: 'filter', tool: 'memory',
    }),
    read('memory.layers.list', 'Layers the caller may read for an agent (personal layers are private to their owner)', {
      in: { agentId: t.opt(id.agent), projectId: t.opt(id.project) },
      out: { layers: t.arr(t.obj({ layer, title: t.str(), readable: t.bool(), writable: t.bool(), private: t.bool() })) }, tool: 'memory',
    }),
    read('memory.counts', 'Counts for the agent strip: current facts, proposed facts, facts from the caller and facts merged on their own', {
      in: { agentId: id.agent }, out: { current: t.int(), proposed: t.int(), fromMe: t.int(), autoMerged: t.int({ minimum: 0, description: 'Current facts that merged on their own because their kind is low risk, so no person accepted them' }) }, tool: 'memory',
    }),
    read('memory.map.get', 'The MAP.md block of an agent as the nightly job last wrote it (agent layer only, never personal memory); absent before the first night', {
      in: { agentId: id.agent }, out: { map: t.opt(t.obj({ body: t.str(), lines: t.int({ minimum: 0 }), updatedAt: t.ts() })) }, label: 'check', tool: 'memory', errors: ['permission.no_grant'],
    }),
    read('memory.pointer', 'Pointer block for a message: up to about 5 lines from a local lookup, no model call, deduplicated against the thread', {
      in: { threadId: id.thread, agentId: id.agent, text: t.str(), sinceIdx: t.opt(t.int()) },
      out: { lines: t.arr(t.obj({ title: t.str(), fact: t.opt(t.str()), trueSince: t.opt(t.ts()), path: t.str() })), tokens: t.int(), skipped: t.opt(t.enm('short_ack', 'mid_tool_loop', 'no_match', 'duplicate')) },
      label: 'filter',
    }),
    // ---- write: facts
    create('memory.propose_fact', 'Propose a fact for the asker layer of the agent memory, with its source; low-risk kinds merge on their own', {
      in: {
        layer: t.opt(layer), agentId: t.opt(id.agent), projectId: t.opt(id.project), text: t.str(), validFrom: t.opt(t.ts()), sourceKind, sourceRef: t.str(), threadId: t.opt(id.thread),
        kind: t.opt(t.str({ description: 'Fact kind, for example preference', examples: ['preference'] })),
      },
      out: { fact: factRow, merged: t.bool() }, emits: ['memory.fact_proposed', 'memory.fact_accepted'], tool: 'memory', mcpName: 'memory_propose', agent: { planMode: 'blocked', blocks: ['memory_saved'] }, errors: ['permission.provider_label'],
    }),
    write('memory.fact.accept', 'Accept a proposed fact into current memory', {
      in: factT, out: { fact: factRow }, emits: ['memory.fact_accepted'], tool: 'memory', offline: 'queue', errors: ['validation.precondition_failed'],
    }),
    write('memory.fact.reject', 'Reject a proposed fact', {
      in: factT, out: { fact: factRow }, emits: ['memory.fact_rejected'], tool: 'memory', offline: 'queue',
    }),
    write('memory.fact.correct', 'Correct a fact: the old one is closed with today as its end date and a new fact is added', {
      in: { ...factT, text: t.str(), validFrom: t.opt(t.ts()) }, out: { fact: factRow, closed: factRow }, emits: ['memory.fact_corrected'], tool: 'memory', offline: 'queue',
    }),
    write('memory.facts.remove', 'Remove facts from answers (closed off, kept in history), one at a time or all at once for a layer or agent', {
      in: { factIds: t.opt(t.arr(id.fact)), scope: t.opt(t.obj({ layer, agentId: t.opt(id.agent), fromMe: t.opt(t.bool()) })) },
      out: { removed: t.int() }, emits: ['memory.removed'], tool: 'memory', audit: 'sensitive', risk: 'medium',
    }),
    write('memory.erase', 'Erase completely: delete facts from history; open to the source person or an admin; the audit entry records who and when, never what', {
      in: { factIds: t.opt(t.arr(id.fact)), scope: t.opt(t.obj({ layer, agentId: t.opt(id.agent), sourceRef: t.opt(t.str()), subject: t.opt(t.str()) })), reason: t.opt(t.str()) },
      out: { erased: t.int() }, perm: null, level: 'manage', emits: ['memory.erased'], gate: { act: 'delete', when: "actor.kind != 'person'" },
      tool: 'memory', audit: 'always', risk: 'high', errors: ['permission.on_hold'],
    }),
    write('memory.promote', 'Promote a fact to the agent, a project or the Space layer; a task for the right approver carries the name and time, no admin needed when the person can edit the target', {
      in: { ...factT, toLayer: t.enm('agent', 'project', 'space'), agentId: t.opt(id.agent), projectId: t.opt(id.project), note: t.opt(t.str()) },
      out: { promotionId, promoted: t.bool(), taskId: t.opt(id.task) }, emits: ['memory.promotion_requested', 'memory.promoted'], tool: 'memory', agent: { planMode: 'blocked', blocks: ['memory_saved'] },
    }),
    write('memory.promotion.approve', 'Approve a promotion request (the approver action on its task)', {
      in: { promotionId }, out: { fact: factRow }, emits: ['memory.promoted'], tool: 'memory', audit: 'sensitive', errors: ['validation.precondition_failed'],
    }),
    write('memory.promotion.reject', 'Reject a promotion request with a note', {
      in: { promotionId, note: t.opt(t.str()) }, out: { ok: t.bool() }, emits: ['memory.promotion_rejected'], tool: 'memory',
    }),
    write('memory.promotion.undo', 'Undo a promotion: the shared copy is closed and the personal fact stays', {
      in: { promotionId }, out: { ok: t.bool() }, emits: ['memory.promotion_undone'], tool: 'memory', audit: 'sensitive',
    }),
    // ---- write: system
    write('memory.capture', 'Capture at chat end: a cheap-model pass proposes facts to the person layer; channel facts go to the project layer, Automation facts to proposed/', {
      in: { threadId: id.thread, reason: t.enm('closed', 'idle') }, out: { proposed: t.int(), merged: t.int() },
      emits: ['memory.captured', 'memory.fact_proposed', 'memory.fact_accepted'], idem: 'natural', risk: 'low', errors: ['permission.provider_label'],
    }),
    write('memory.maintain', 'Nightly job: merge accepted facts, close old versions, rewrite MAP.md (under 200 lines) for each agent', {
      in: { agentId: t.opt(id.agent) }, out: { merged: t.int(), closed: t.int(), maps: t.int() }, emits: ['memory.map_rewritten'], idem: 'natural', risk: 'low',
    }),
    write('memory.index_graph', 'Graph consumer: update graph nodes and edges for a changed note, record or chat (notes, links, relations, came-from)', {
      in: { entity: t.str(), id: t.str(), seq: t.int({ minimum: 0 }) }, out: { nodes: t.int(), edges: t.int() }, idem: 'natural', risk: 'low',
    }),
    // ---- graph (names kept verbatim: memory.graph)
    read('memory.graph', 'The memory graph for an agent or the Space, built per viewer through access checks; agent, project and Space layers only', {
      in: graphIn, out: graphOut, label: 'filter', tool: 'memory', cli: 'vyre memory graph',
    }),
    read('memory.graph_everything', 'The admin "everything" graph view across all agents; every open is logged', {
      in: { asOf: t.opt(t.ts()) }, out: graphOut, perm: 'memory.admin', level: 'manage', audit: 'always', risk: 'high', label: 'filter', tool: 'memory', emits: ['memory.everything_viewed'],
    }),
    write('memory.graph_export', 'Export a graph as a file; personal layers are never included', {
      in: graphIn, out: { fileId: id.file }, tool: 'memory', audit: 'sensitive', risk: 'medium', idem: 'natural',
    }),
    read('memory.layout.get', 'Saved node positions for a graph', {
      in: { scope: graphScope, agentId: t.opt(id.agent) }, out: { positions: t.rec(t.obj({ x: t.num(), y: t.num() })) }, tool: 'memory',
    }),
    write('memory.layout.save', 'Save node positions for a graph', {
      in: { scope: graphScope, agentId: t.opt(id.agent), positions: t.rec(t.obj({ x: t.num(), y: t.num() })) }, out: { ok: t.bool() }, tool: 'memory', offline: 'queue', idem: 'natural', risk: 'low',
    }),
    // ---- history and subject lookup
    read('memory.versions', 'List versions of a shared memory note (One History)', {
      in: { noteId: id.note }, out: { versions: t.arr(versionRow) }, on: ['note', '/noteId'], tool: 'memory',
    }),
    write('memory.restore_version', 'Restore a shared memory note to an earlier version (owners and admins)', {
      in: { noteId: id.note, versionId: id.version }, out: { note: noteRow }, on: ['note', '/noteId'], level: 'manage', emits: ['memory.note_restored'], tool: 'memory', agent: { planMode: 'blocked' },
    }),
    read('memory.find_by_subject', 'Find every fact and note about one subject (a contact, company or person) for erase and export', {
      in: { subject: t.str({ description: 'Record id, person id or free text identifier' }), ...pageIn }, out: { facts: t.arr(factRow), notes: t.arr(noteRow), ...pageOut },
      perm: 'memory.admin', level: 'manage', audit: 'always', label: 'filter',
    }),
  ],
  events: [
    // ---- erase and purge (P-CC_39): governance removes data through these; each hard-deletes inside its own store
    ev('note.erased', 'A memory note was erased for good (ids only)', { p: { noteId: id.note }, subject: ['entity', '/noteId'], retention: 'audit' }),
    ev('memory.fact_proposed', 'A fact was proposed (ids and layer only, never the text)', {
      p: { factId: id.fact, layer, ownerRef: t.str(), agentId: t.opt(id.agent), sourceKind: t.str(), sourceRef: t.str() }, subject: ['entity', '/factId'], vis: 'participants', label: 'subject', retention: 'memory',
    }),
    ev('memory.fact_accepted', 'A proposed fact became current', { p: { factId: id.fact, layer, auto: t.bool() }, subject: ['entity', '/factId'], vis: 'participants', label: 'subject', retention: 'memory' }),
    ev('memory.fact_rejected', 'A proposed fact was rejected', { p: { factId: id.fact, by: t.str() }, subject: ['entity', '/factId'], vis: 'participants', retention: 'memory' }),
    ev('memory.fact_corrected', 'A fact was corrected: the old one closed, a new one added', {
      p: { factId: id.fact, closedFactId: id.fact, by: t.str() }, subject: ['entity', '/factId'], vis: 'participants', retention: 'memory',
    }),
    ev('memory.promotion_requested', 'A promotion to a shared layer was requested', {
      p: { promotionId, factId: id.fact, toLayer: t.str(), taskId: t.opt(id.task), by: t.str() }, subject: ['entity', '/factId'], vis: 'participants', retention: 'memory',
    }),
    ev('memory.promoted', 'A fact was promoted to a shared layer with the name and time of the person', {
      p: { promotionId, factId: id.fact, newFactId: id.fact, toLayer: t.str(), by: t.str() }, subject: ['entity', '/newFactId'], retention: 'memory',
    }),
    ev('memory.promotion_rejected', 'A promotion was rejected', { p: { promotionId, factId: id.fact, by: t.str() }, subject: ['entity', '/factId'], vis: 'participants', retention: 'memory' }),
    ev('memory.promotion_undone', 'A promotion was undone', { p: { promotionId, factId: id.fact, by: t.str() }, subject: ['entity', '/factId'], retention: 'memory' }),
    ev('memory.removed', 'Facts were removed from answers (kept in history)', { p: { factIds: t.arr(id.fact), by: t.str() }, subject: ['entity', '/by'], vis: 'participants', retention: 'memory' }),
    ev('memory.erased', 'Facts were erased from history (who and when only)', { p: { count: t.int(), by: t.str(), scope: t.opt(t.str()) }, subject: ['entity', '/by'], vis: 'participants', retention: 'memory' }),
    ev('memory.captured', 'Capture ran for a thread', { p: { threadId: id.thread, proposed: t.int(), merged: t.int() }, subject: ['thread', '/threadId'], vis: 'participants', retention: 'memory' }),
    ev('memory.map_rewritten', 'MAP.md of an agent was rewritten by the nightly job', { p: { agentId: id.agent, lines: t.int() }, subject: ['agent', '/agentId'], retention: 'memory' }),
    ev('memory.note_restored', 'A shared memory note was restored to an earlier version', { p: { noteId: id.note, versionId: id.version, by: t.str() }, subject: ['note', '/noteId'], retention: 'memory' }),
    ev('memory.everything_viewed', 'An admin opened the everything graph view', { p: { by: t.str() }, subject: ['entity', '/by'], retention: 'audit' }),
  ],
  blocks: [
    block('memory_saved', {
      factId: id.fact, layer, agentId: t.opt(id.agent), text: t.str(), canPromote: t.bool(),
    }, 'Saved to your {{layer}} layer: {{text}}', {
      actions: [{ key: 'propose_for_team', label: 'Propose for team', cap: 'memory.promote', input: { factId: '/factId' } }],
    }),
  ],
  settings: [
    setting('memory.weekly_nudge', 'person', 'Memory and privacy', 'Weekly reminder about proposed facts', t.bool(), true),
    setting('memory.auto_merge_kinds', 'space', 'Policies', 'Fact kinds that merge without review', t.arr(t.str()), ['preference']),
  ],
  screens: [
    screen('chats.agent-memory', 'chats', 'ui:AgentMemory', {
      slot: 'side',
      q: {
        facts: ['memory.facts.list', { agentId: '/state/agentId', fromMe: '/state/fromMe', status: '/state/status', layer: '/state/layer' }, true],
        layers: ['memory.layers.list', { agentId: '/state/agentId' }, true], counts: ['memory.counts', { agentId: '/state/agentId' }, true],
      },
      a: {
        accept: ['memory.fact.accept', { factId: '/state/factId' }], reject: ['memory.fact.reject', { factId: '/state/factId' }], correct: ['memory.fact.correct', { factId: '/state/factId' }],
        remove: ['memory.facts.remove', {}, 'Remove from answers?'], erase: ['memory.erase', {}, 'Erase completely? This deletes it from history.'], promote: ['memory.promote', { factId: '/state/factId' }],
      },
      empty: 'Nothing remembered yet', primary: 'Ask the agent to remember something',
    }),
    screen('files.memory-graph', 'files', 'ui:MemoryGraph', {
      q: { graph: ['memory.graph', { scope: '/state/scope', agentId: '/state/agentId', asOf: '/state/asOf' }, true], layout: ['memory.layout.get', { scope: '/state/scope', agentId: '/state/agentId' }, false] },
      a: { saveLayout: ['memory.layout.save', { scope: '/state/scope', agentId: '/state/agentId' }], exportGraph: ['memory.graph_export', { scope: '/state/scope', agentId: '/state/agentId' }] },
      empty: 'No notes to draw yet', primary: 'Open Files', perf: { firstPaintMs: 50, completeMs: 100 },
    }),
    screen('files.memory-proposed', 'files', 'ui:MemoryProposed', {
      q: { proposed: ['memory.facts.list', { agentId: '/state/agentId', status: '/state/status' }, true], notes: ['memory.notes.list', { agentId: '/state/agentId', area: '/state/area' }, true] },
      a: { accept: ['memory.fact.accept', { factId: '/state/factId' }], reject: ['memory.fact.reject', { factId: '/state/factId' }] },
      empty: 'Nothing waiting for review', primary: 'Close',
    }),
  ],
});
