// gate (lane L6): one approval model for every outward or risky act (spec 2.14, 4.4; architecture 4.6).
// Declares the ten Gate act kinds. `invoke` calls gate.park when authorize returns hold; approving a task calls gate.release.
// DECISION: all ten acts send on approve through `gate.release`, which re-invokes the parked capability with an approval token bound to the payload hash.
// DECISION: timeouts, approvers and humanToo follow spec 2.14. Defaults (24 h, escalate, 4 h email backstop) apply to every act; Policies override them per act.
// DECISION: Gate events use retention 'audit'. gate.release and gate.park are system capabilities (no tool); approving goes through tasks.act.
import { defineManifest, ev, gateAct, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, principalRef, risk } from './_common.ts';

const actKey = t.enm('send', 'post', 'pay', 'delete', 'push_protected', 'campaign_launch', 'secret_export', 'site_promote', 'signature_send', 'spend_raise');
const holdState = t.enm('held', 'approved', 'denied', 'expired');
const approverRule = t.str({ description: "role:<name>, owner or asker", examples: ['role:admin'] });
const ruleRow = t.obj({
  act: actKey, mode: t.enm('hold', 'allow'), approvers: approverRule, peopleOnly: t.bool(), agentOkFor: t.opt(risk),
  afterHours: t.int({ minimum: 1 }), onTimeout: t.enm('drop', 'escalate'), escalateTo: t.enm('delegate', 'role'), emailBackstopHours: t.int({ minimum: 1 }),
  scope: t.enm('space', 'floor', 'agent'), agentId: t.opt(id.agent),
});
const holdRow = t.obj({
  id: t.id('hld'), act: actKey, capName: t.str({ examples: ['mail.send'] }), taskId: id.task, runId: t.opt(id.run), principal: principalRef,
  actingFor: t.opt(t.str()), state: holdState, payloadHash: t.str(), createdAt: t.ts(), expiresAt: t.ts(),
});
const holdId = t.id('hld');

export default defineManifest({
  id: 'gate',
  title: 'Gate',
  owner: 'L6',
  gateActs: [
    gateAct('send', 'Send a message', 'medium', 'doc_excerpt', { approvers: { default: 'asker', peopleOnly: true, agentOkFor: 'low' } }),
    gateAct('post', 'Post publicly', 'medium', 'doc_excerpt', { approvers: { default: 'asker', peopleOnly: true, agentOkFor: 'low' } }),
    gateAct('pay', 'Send money or submit a card', 'high', 'table', { approvers: { default: 'owner', peopleOnly: true } }),
    gateAct('delete', 'Delete', 'high', 'record_card', { approvers: { default: 'asker', peopleOnly: true } }),
    gateAct('push_protected', 'Push to a protected branch', 'high', 'diff', { appliesTo: { actors: ['agent', 'automation', 'campaign'], humanToo: true } }),
    gateAct('campaign_launch', 'Launch a campaign', 'high', 'table', { appliesTo: { actors: ['agent', 'automation', 'campaign'], humanToo: true } }),
    gateAct('secret_export', 'Export secrets', 'high', 'table', { appliesTo: { actors: ['agent', 'automation', 'campaign'], humanToo: true } }),
    gateAct('site_promote', 'Promote a site to production', 'high', 'deploy', { appliesTo: { actors: ['agent', 'automation', 'campaign'], humanToo: true } }),
    gateAct('signature_send', 'Send a document for signature', 'high', 'file'),
    gateAct('spend_raise', 'Raise a spend cap', 'medium', 'table'),
  ],
  events: [
    ev('gate.requested', 'A gated act stopped and became an Approve task with the exact preview', { p: { holdId, act: actKey, capName: t.str(), taskId: id.task, principal: principalRef, actingFor: t.opt(t.str()), runId: t.opt(id.run), expiresAt: t.ts() }, subject: ['task', '/taskId'], vis: 'participants', retention: 'audit', label: 'subject' }),
    ev('gate.approved', 'A gated act was approved and released', { p: { holdId, act: actKey, taskId: id.task, by: t.str(), forPerson: t.opt(t.str()) }, subject: ['task', '/taskId'], vis: 'participants', retention: 'audit', label: 'subject' }),
    ev('gate.denied', 'A gated act was sent back or dropped', { p: { holdId, act: actKey, taskId: id.task, by: t.str(), mode: t.enm('send_back', 'drop'), note: t.opt(t.str()) }, subject: ['task', '/taskId'], vis: 'participants', retention: 'audit', label: 'subject' }),
    ev('gate.expired', 'A hold timed out: dropped or escalated to a delegate or role', { p: { holdId, act: actKey, taskId: id.task, outcome: t.enm('dropped', 'escalated'), escalatedTo: t.opt(t.str()) }, subject: ['task', '/taskId'], vis: 'participants', retention: 'audit', label: 'subject', trigger: { title: 'A gated act expires', fields: ['/act'] } }),
    ev('gate.rule_changed', 'A Gate rule changed (Space default, owner floor or per-agent override)', { p: { act: actKey, scope: t.enm('space', 'floor', 'agent'), agentId: t.opt(id.agent), by: t.str() }, subject: ['entity', '/act'], retention: 'audit' }),
  ],
  capabilities: [
    write('gate.park', 'Park a call that authorize held: render the exact preview, create the Approve task, park the call (called by invoke)', {
      in: { capName: t.str({ examples: ['mail.send'] }), capVersion: t.int({ minimum: 1 }), input: t.json(), payloadHash: t.str(), act: actKey, principal: principalRef, actingFor: t.opt(t.str()), decisionId: t.str(), runId: t.opt(id.run), threadId: t.opt(id.thread) },
      out: { holdId, taskId: id.task, runId: t.opt(id.run) }, emits: ['gate.requested'], idem: 'key', audit: 'always',
    }),
    write('gate.release', 'Re-invoke the parked capability with an approval token bound to the payload hash, then resume the turn or step', {
      in: { holdId, taskId: id.task, approvalToken: t.str({ description: 'Approval token, valid 10 minutes, bound to the payload hash' }) },
      out: { result: t.json() }, on: ['task', '/taskId'], level: 'use', emits: ['gate.approved'], audit: 'always', idem: 'natural',
      errors: ['permission.expired', 'validation.precondition_failed'],
    }),
    write('gate.deny', 'Deny a hold: send back with a note for the asker thread, or drop the call', {
      in: { holdId, taskId: id.task, mode: t.enm('send_back', 'drop'), note: t.opt(t.str()) }, out: { ok: t.bool() }, on: ['task', '/taskId'], level: 'use', emits: ['gate.denied'], audit: 'always',
    }),
    write('gate.expire', 'Apply the timeout of a hold: drop it or escalate to the delegate or role (called by the scheduler)', {
      in: { holdId }, out: { outcome: t.enm('dropped', 'escalated'), escalatedTo: t.opt(t.str()) }, emits: ['gate.expired'], audit: 'always',
    }),
    read('gate.effective_rule', 'The effective rule for a principal and act: the strictest of Space policy, owner floor and agent.toml', {
      in: { principal: principalRef, act: actKey },
      out: {
        hold: t.bool(), reason: t.str(), approvers: approverRule, peopleOnly: t.bool(), afterHours: t.int(), onTimeout: t.enm('drop', 'escalate'),
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
