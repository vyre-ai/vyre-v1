// gate (lane L6): one approval model for every outward or risky act (spec 2.14, 4.4; architecture 4.6).
// Declares the Gate act kinds. `invoke` calls gate.park when authorize returns hold; approving a task calls gate.release.
// DECISION: all ten acts send on approve through `gate.release`, which re-invokes the parked capability with an approval token bound to the payload hash.
// DECISION: timeouts, approvers and humanToo follow spec 2.14. Defaults (24 h, escalate, 4 h email backstop) apply to every act; Policies override them per act.
// DECISION: Gate events use retention 'audit'. gate.release and gate.park are system capabilities (no tool); approving goes through tasks.act.
import { defineManifest, ev, gateAct, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, principalRef, risk } from './_common.ts';

const actKey = t.enm('send', 'post', 'pay', 'delete', 'transfer', 'enroll_node', 'connection_change', 'push_protected', 'secret_export', 'site_promote', 'signature_send', 'spend_raise', 'signin_change', 'approve');
const holdState = t.enm('held', 'approved', 'denied', 'expired');
const approverRule = t.str({ description: "role:<name>, owner or asker", examples: ['role:admin'] });
const ruleRow = t.obj({
  act: actKey, mode: t.enm('hold', 'allow'), approvers: approverRule, peopleOnly: t.bool(), agentOkFor: t.opt(risk),
  afterHours: t.int({ minimum: 1 }), onTimeout: t.enm('drop', 'escalate'), escalateTo: t.enm('delegate', 'role'), emailBackstopHours: t.int({ minimum: 1 }),
  scope: t.enm('space', 'floor', 'agent'), agentId: t.opt(id.agent),
});
const holdRow = t.obj({
  id: t.id('hld'), act: actKey, capName: t.str({ examples: ['mail.send'] }), taskId: id.task, runId: t.opt(id.run), principal: principalRef,
  actingFor: t.opt(t.str()), state: holdState, payloadHash: t.str(), createdAt: t.ts(), expiresAt: t.ts(), askedBy: t.opt(principalRef),
});
const holdId = t.id('hld');
/** Where a held call came from, recorded at hold time: the capability, the chat, the agent that made it and the person it acted for (an answer wakes that agent there). */
const heldFrom = { capName: t.opt(t.str()), threadId: t.opt(t.str()), agentId: t.opt(t.str()), actingFor: t.opt(t.str()) };
const stepRef = t.obj({ automationId: id.automation, nodeId: t.str(), defHash: t.str(), ask: t.opt(t.bool()) });
const allowRow = t.obj({ id: t.str(), kind: t.enm('standing', 'always', 'goal'), act: actKey, target: t.str(), agentId: t.opt(id.agent), threadId: t.opt(id.thread), automationId: t.opt(id.automation), stepId: t.opt(t.str()), goalId: t.opt(id.goal), expiresAt: t.opt(t.ts()) });
const grantRow = t.obj({ id: t.str(), act: actKey, target: t.str(), stepId: t.opt(t.str()) });

export default defineManifest({
  id: 'gate',
  title: 'Gate',
  owner: 'L6',
  gateActs: [
    gateAct('send', 'Send a message', 'medium', 'doc_excerpt', { approvers: { default: 'asker', peopleOnly: true, agentOkFor: 'low' } }),
    gateAct('post', 'Post publicly', 'medium', 'doc_excerpt', { approvers: { default: 'asker', peopleOnly: true, agentOkFor: 'low' } }),
    gateAct('pay', 'Send money or submit a card', 'high', 'table', { approvers: { default: 'owner', peopleOnly: true } }),
    gateAct('delete', 'Delete', 'high', 'record_card', { approvers: { default: 'asker', peopleOnly: true } }),
    gateAct('transfer', 'Hand over ownership', 'high', 'record_card', { approvers: { default: 'asker', peopleOnly: true } }),
    gateAct('enroll_node', 'Admit a computer to the Space', 'high', 'record_card', { approvers: { default: 'asker', peopleOnly: true } }),
    gateAct('connection_change', 'Change a company-wide connection', 'high', 'table', { approvers: { default: 'asker', peopleOnly: true } }),
    gateAct('push_protected', 'Push to a protected branch', 'high', 'diff', { appliesTo: { actors: ['agent', 'automation'], humanToo: true } }),
    gateAct('secret_export', 'Export secrets', 'high', 'table', { appliesTo: { actors: ['agent', 'automation'], humanToo: true } }),
    gateAct('site_promote', 'Promote a site to production', 'high', 'deploy', { appliesTo: { actors: ['agent', 'automation'], humanToo: true } }),
    gateAct('signature_send', 'Send a document for signature', 'high', 'file'),
    gateAct('spend_raise', 'Raise a spend cap', 'medium', 'table'),
    gateAct('signin_change', 'Change how people sign in to the Space', 'high', 'record_card', { approvers: { default: 'asker', peopleOnly: true } }),
    // Ask mode in a chat: the agent stops before any step that changes something and the person it works for allows it, whatever the step is.
    gateAct('approve', 'Allow this step', 'medium', 'doc_excerpt', { approvers: { default: 'asker', peopleOnly: true } }),
  ],
  events: [
    ev('gate.requested', 'A gated act stopped and became an Approve task with the exact preview', { p: { holdId, act: actKey, capName: t.str(), taskId: id.task, principal: principalRef, actingFor: t.opt(t.str()), runId: t.opt(id.run), expiresAt: t.ts(), askedBy: t.opt(principalRef) }, subject: ['task', '/taskId'], vis: 'participants', retention: 'audit', label: 'subject' }),
    ev('gate.approved', 'A gated act was approved and released', { p: { holdId, act: actKey, taskId: id.task, by: t.str(), forPerson: t.opt(t.str()), askedBy: t.opt(principalRef), ...heldFrom }, subject: ['task', '/taskId'], vis: 'participants', retention: 'audit', label: 'subject' }),
    ev('gate.revised', 'A held message was edited before it was sent: the approval is bound to the new words', { p: { holdId, act: actKey, taskId: id.task, by: t.str(), was: t.str({ maxLength: 20000 }), now: t.str({ maxLength: 20000 }) }, subject: ['task', '/taskId'], vis: 'participants', retention: 'audit', label: 'subject' }),
    ev('gate.denied', 'A gated act was sent back or dropped', { p: { holdId, act: actKey, taskId: id.task, by: t.str(), mode: t.enm('send_back', 'drop'), note: t.opt(t.str()), askedBy: t.opt(principalRef), ...heldFrom }, subject: ['task', '/taskId'], vis: 'participants', retention: 'audit', label: 'subject' }),
    ev('gate.expired', 'A hold timed out: dropped or escalated to a delegate or role', { p: { holdId, act: actKey, taskId: id.task, outcome: t.enm('dropped', 'escalated'), escalatedTo: t.opt(t.str()), askedBy: t.opt(principalRef) }, subject: ['task', '/taskId'], vis: 'participants', retention: 'audit', label: 'subject', trigger: { title: 'A gated act expires', fields: ['/act'] } }),
    ev('gate.rule_changed', 'A Gate rule changed (Space default, owner floor or per-agent override)', { p: { act: actKey, scope: t.enm('space', 'floor', 'agent'), agentId: t.opt(id.agent), by: t.str() }, subject: ['entity', '/act'], retention: 'audit' }),
  ],
  capabilities: [
    write('gate.park', 'Park a call that authorize held: render the exact preview, create the Approve task, park the call (called by invoke)', {
      in: { capName: t.str({ examples: ['mail.send'] }), capVersion: t.int({ minimum: 1 }), input: t.json(), payloadHash: t.str(), act: actKey, principal: principalRef, actingFor: t.opt(t.str()), decisionId: t.str(), runId: t.opt(id.run), threadId: t.opt(id.thread), step: t.opt(stepRef),
        // Ask the person (docs/ask-the-person.md): an agent asked the person this runs as (principal); only that person approves it, and the card names the agent and what happens.
        ask: t.opt(t.obj({ by: principalRef, what: t.str() })) },
      out: { holdId, taskId: id.task, runId: t.opt(id.run) }, emits: ['gate.requested'], idem: 'key', audit: 'always',
    }),
    write('gate.grants.set', 'Replace what an automation may send without a hold, for its definition as saved now. A person pressing Save or Turn on writes rows for the outward steps it names; anyone else leaves the automation with none', {
      in: {
        automationId: id.automation, defHash: t.str(), press: t.enm('save', 'on'),
        steps: t.arr(t.obj({ stepId: t.str(), act: actKey, targets: t.arr(t.str()), computed: t.bool(), changed: t.bool() })),
      },
      out: { grants: t.arr(grantRow) }, perm: null, level: 'view', audit: 'always', idem: 'natural',
    }),
    write('gate.grants.take', 'System: does a grant cover this call? Asked by the Gate hook at act time, it spends a single-use grant; only the server may call it', {
      in: { act: actKey, targets: t.arr(t.str()), step: t.opt(stepRef), turn: t.opt(t.obj({ person: t.str(), threads: t.arr(id.thread, { minItems: 1 }) })), always: t.opt(t.obj({ person: t.str(), agentId: t.str(), threads: t.arr(id.thread), cap: t.str() })) },
      out: { granted: t.bool(), spent: t.opt(t.arr(t.str())) }, perm: null, level: 'view', idem: 'natural',
    }),
    write('gate.grants.goal', 'System: what a goal may do without a hold. The owner\'s press on the goal names the acts (set); the goal\'s own chats are where they hold, and only while it runs (threads, empty to end them). Only the goals module calls it', {
      in: { goalId: id.goal, person: id.user, threads: t.arr(id.thread), until: t.ts(), set: t.opt(t.arr(t.obj({ act: actKey, target: t.str({ minLength: 1 }) }), { maxItems: 10 })) },
      out: { acts: t.int({ minimum: 0 }), rows: t.int({ minimum: 0 }) }, perm: null, level: 'view', audit: 'always', idem: 'natural',
    }),
    write('gate.grants.give_back', 'System: hand back the turn grants a call spent when the call was refused before it went out; only the server may call it', {
      in: { ids: t.arr(t.str(), { minItems: 1 }) }, out: { returned: t.int() }, perm: null, level: 'view', idem: 'natural',
    }),
    write('gate.allow.set', 'Always allow: a rule the Gate reads, for one agent or one chat, one act and one target, with an expiry. Local changes are a person\'s to allow; an outward act needs an admin; money is never allowed this way', {
      in: { act: actKey, target: t.str({ minLength: 1 }), agentId: t.opt(id.agent), threadId: t.opt(id.thread), days: t.opt(t.int({ minimum: 1, maximum: 90 })), until: t.opt(t.ts({ description: 'Today: allowed until this moment, the end of the person\'s day, within a day and a half' })), recipient: t.opt(t.bool()) },
      out: { rule: allowRow }, perm: null, level: 'view', audit: 'always', errors: ['validation.bad_input', 'permission.role_lacks_permission'],
    }),
    read('gate.allow.list', 'What may go without asking: your Always allow rules and the automations your press gave permission to', {
      in: {}, out: { rules: t.arr(allowRow) }, perm: null, level: 'view',
    }),
    write('gate.allow.remove', 'Take an Always allow rule or an automation\'s permission back. It stops at the next act', {
      in: { id: t.str() }, out: { ok: t.bool() }, perm: null, level: 'view', audit: 'always', errors: ['permission.not_found'],
    }),
    write('gate.taint.mark', 'System: outside words entered the turn in these threads, and the links a page gave are now known. Only the server may call it', {
      in: { threads: t.arr(id.thread, { minItems: 1 }), source: t.str(), links: t.opt(t.arr(t.str())) },
      out: { ok: t.bool() }, perm: null, level: 'view', idem: 'natural',
    }),
    read('gate.links.known', 'System: did the person give this link, or did a page already read in this chat link to it', {
      in: { url: t.str(), threads: t.arr(id.thread, { minItems: 1 }) }, out: { known: t.bool() }, perm: null, level: 'view',
    }),
    write('gate.grants.ask', 'What a person asks for in their own message: one single-use grant per act and target, read from their words by the server before the turn starts', {
      in: { threadId: id.thread, messageId: id.message, asked: t.arr(t.obj({ act: actKey, target: t.str() })), links: t.opt(t.arr(t.str())), since: t.opt(t.ts({ description: 'When the agent last replied in the thread: what was asked since then still counts, so a second message with no extra words does not take back the first' })) },
      out: { ok: t.bool() }, perm: null, level: 'view', idem: 'natural',
    }),
    write('gate.release', 'Re-invoke the parked capability with an approval token bound to the payload hash, then resume the turn or step', {
      in: { holdId, taskId: id.task, approvalToken: t.str({ description: 'Approval token, valid 10 minutes, bound to the payload hash' }) },
      out: { result: t.json() }, on: ['task', '/taskId'], level: 'use', emits: ['gate.approved'], audit: 'always', idem: 'natural',
      errors: ['permission.expired', 'validation.precondition_failed'],
    }),
    // The edit of a held message: the stored call is rewritten (its words only), the hash the approval is bound to is made again, and the task's card shows it was edited by the person. The person who may approve it
    // may revise it; the agent cannot, and a held act that is not a message cannot be edited. Approving after the edit sends the edited words.
    write('gate.holds.revise', 'Change what a held message says before it is sent. The approval is bound to the new words and the card says it was edited', {
      in: { holdId, taskId: id.task, body: t.str({ maxLength: 20000 }), title: t.opt(t.str({ maxLength: 300 })) }, out: { ok: t.bool(), edited: t.int() }, on: ['task', '/taskId'], level: 'use', emits: ['gate.revised'], audit: 'always',
      errors: ['validation.precondition_failed', 'permission.no_grant'],
    }),
    write('gate.deny', 'Deny a hold: send back with a note for the asker thread, or drop the call', {
      in: { holdId, taskId: id.task, mode: t.enm('send_back', 'drop'), note: t.opt(t.str()) }, out: { ok: t.bool() }, on: ['task', '/taskId'], level: 'use', emits: ['gate.denied'], audit: 'always',
    }),
    write('gate.expire', 'Apply the timeout of a hold: drop it or escalate to the delegate or role (called by the scheduler)', {
      in: { holdId }, out: { outcome: t.enm('dropped', 'escalated'), escalatedTo: t.opt(t.str()) }, emits: ['gate.expired'], audit: 'always',
    }),
    read('gate.effective_rule', 'The effective rule for a principal and act: the strictest of Space policy, owner floor and agent.toml', {
      in: { principal: principalRef, act: actKey, adminOnly: t.opt(t.bool()) },
      out: {
        hold: t.bool(), adminRule: t.bool(), reason: t.str(), approvers: approverRule, peopleOnly: t.bool(), afterHours: t.int(), onTimeout: t.enm('drop', 'escalate'),
        sources: t.obj({ space: t.enm('hold', 'allow'), floor: t.opt(t.enm('hold', 'allow')), agent: t.opt(t.enm('hold', 'allow')) }),
      },
      tool: 'meta', agent: true,
    }),
    read('gate.acts.list', 'The ten Gate act kinds with risk, preview and who they apply to', {
      in: {}, out: { acts: t.arr(t.obj({ key: actKey, title: t.str(), risk, humanToo: t.bool(), peopleOnly: t.bool() })) }, tool: 'meta',
    }),
    read('gate.rules.list', 'List Gate rules: Space defaults, the owner floor and per-agent overrides', {
      in: { scope: t.opt(t.enm('space', 'floor', 'agent')), agentId: t.opt(id.agent) }, out: { rules: t.arr(ruleRow) }, tool: 'engineer',
    }),
    write('gate.rules.set', 'Set a Gate rule for an act at the Space, owner floor or agent level; a rule can never loosen the strictest level', {
      in: {
        act: actKey, scope: t.enm('space', 'floor', 'agent'), agentId: t.opt(id.agent), mode: t.enm('hold', 'allow'), approvers: t.opt(approverRule),
        agentOkFor: t.opt(risk), afterHours: t.opt(t.int({ minimum: 1 })), onTimeout: t.opt(t.enm('drop', 'escalate')), escalateTo: t.opt(t.enm('delegate', 'role')),
      },
      out: { rule: ruleRow }, perm: 'policy.manage', level: 'manage', risk: 'high', emits: ['gate.rule_changed'], audit: 'always', tool: 'engineer',
      errors: ['validation.precondition_failed'],
    }),
    read('gate.holds.list', 'List holds with their state, act and task', {
      in: { states: t.opt(t.arr(holdState)), act: t.opt(actKey), runId: t.opt(id.run), ...pageIn }, out: { holds: t.arr(holdRow), ...pageOut }, tool: 'meta', label: 'filter',
    }),
    write('gate.result.take', 'System: hand the engine the answer of an approved call for a chat turn parked on it, once, and clear it. Only the server may call it; a requester or approver never reads the answer here.', {
      in: { holdId }, out: { found: t.bool(), result: t.opt(t.json()) }, perm: null, level: 'view', idem: 'natural',
    }),
    read('gate.holds.get', 'Read one hold', { in: { holdId }, out: { hold: holdRow }, tool: 'meta', label: 'check' }),
  ],
  settings: [
    setting('gate.drafted_by_label', 'space', 'Policies', 'Label outward messages as drafted by an agent', t.bool(), true),
    setting('gate.email_backstop_hours', 'space', 'Policies', 'Hours before one email reminds the approver', t.int({ minimum: 1, maximum: 72 }), 4, { floorable: true }),
    setting('gate.timeout_hours', 'space', 'Policies', 'Default hours before a hold times out', t.int({ minimum: 1, maximum: 720 }), 24),
  ],
  screens: [
    screen('gate.rules', 'console', 'ui:GateRules', {
      q: { rules: ['gate.rules.list', { scope: '/state/scope', agentId: '/state/agentId' }, true], acts: ['gate.acts.list', {}, false], holds: ['gate.holds.list', { states: '/state/states' }, true] },
      a: { set: ['gate.rules.set', { act: '/draft/act', scope: '/draft/scope', agentId: '/draft/agentId', mode: '/draft/mode', approvers: '/draft/approvers', afterHours: '/draft/afterHours', onTimeout: '/draft/onTimeout' }] },
      needs: ['policy.manage'], empty: 'No rules set; the Space defaults apply',
    }),
  ],
});
