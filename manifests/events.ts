// events (lane L6): reads of the Space event log (spec 2.22; architecture 4.2) and outgoing webhooks (Console > Integrations > Webhooks).
// The log itself is written by the kernel; this module owns the read capabilities, the event catalogue, the replay sandbox entry and the
// async consumer `events.webhooks_out` that delivers subscribed events with a signature.
// DECISION: events.list, events.get and events.since need no role permission: results are filtered by vis, ACL and label for the reader (label 'filter').
// Replay needs `server.logs` (plus console.access in the Console route), as the spec says.
// DECISION: webhook deliveries are signed with HMAC-SHA256 over `<timestamp>.<body>` in header `x-vyre-signature` (`t=<ts>,v1=<hex>`), with `x-vyre-trace`
// and `x-vyre-event` headers. The secret is returned once on create and rotate and never stored in the clear after that.
// DECISION: failed deliveries retry with exponential backoff for 24 hours, then the delivery is 'gave_up' and the endpoint is disabled after 20 gave_up in a row.
import { defineManifest, ev, health, outward, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut, resourceRef, runStarted, url } from './_common.ts';

const whId = t.id('whk');
const dlvId = t.id('dlv');
const deliveryState = t.enm('pending', 'retrying', 'delivered', 'failed', 'gave_up');
const eventRow = t.obj({
  seq: t.int({ minimum: 1 }), id: id.event, type: t.str({ examples: ['record.updated'] }), sv: t.int({ minimum: 1 }), at: t.ts(), traceId: id.trace,
  actor: t.str({ examples: ['usr_a1b2c3'] }), onBehalf: t.opt(t.str()), runId: t.opt(id.run), cause: t.opt(id.event), origin: t.opt(t.str({ examples: ['automation:aut_a1b2c3'] })),
  depth: t.int({ minimum: 0 }), subject: t.opt(resourceRef), payload: t.json(),
});
const webhookRow = t.obj({
  id: whId, name: t.str(), url, eventTypes: t.arr(t.str({ description: 'Event name or a prefix pattern such as record.*', examples: ['record.updated'] })),
  filter: t.opt(t.json()), active: t.bool(), secretHint: t.str({ description: 'Last four characters of the signing secret' }),
  createdBy: t.str(), createdAt: t.ts(), lastDeliveryAt: t.opt(t.ts()), failureStreak: t.int({ minimum: 0 }),
});
const deliveryRow = t.obj({
  id: dlvId, webhookId: whId, eventId: id.event, eventType: t.str(), state: deliveryState, attempts: t.int({ minimum: 0 }),
  httpStatus: t.opt(t.int()), lastError: t.opt(t.str()), at: t.ts(), nextAttemptAt: t.opt(t.ts()), durationMs: t.opt(t.int()),
});
const target = { webhookId: whId };
const gateNone = { act: 'none', reason: 'A signed delivery of a system event to a URL an admin registered; no actor authors the content' };

export default defineManifest({
  id: 'events',
  title: 'Events and webhooks',
  owner: 'L6',
  events: [
    ev('webhook.created', 'An outgoing webhook was created', { p: { webhookId: whId, name: t.str(), eventTypes: t.arr(t.str()) }, subject: ['entity', '/webhookId'], retention: 'events' }),
    ev('webhook.updated', 'An outgoing webhook changed', { p: { webhookId: whId, fields: t.arr(t.str()) }, subject: ['entity', '/webhookId'], retention: 'events' }),
    ev('webhook.deleted', 'An outgoing webhook was deleted', { p: { webhookId: whId }, subject: ['entity', '/webhookId'], retention: 'events' }),
    ev('webhook.secret_rotated', 'The signing secret of a webhook was rotated (value not in the event)', { p: { webhookId: whId, by: t.str() }, subject: ['entity', '/webhookId'], retention: 'audit' }),
    ev('webhook.delivered', 'A webhook delivery succeeded', { p: { deliveryId: dlvId, webhookId: whId, eventId: id.event, httpStatus: t.int(), attempts: t.int() }, subject: ['entity', '/webhookId'], retention: 'logs', replay: 'stub' }),
    ev('webhook.delivery_failed', 'A webhook delivery attempt failed', { p: { deliveryId: dlvId, webhookId: whId, eventId: id.event, httpStatus: t.opt(t.int()), error: t.str(), attempts: t.int(), willRetry: t.bool() }, subject: ['entity', '/webhookId'], retention: 'logs', replay: 'stub' }),
    ev('webhook.disabled', 'A webhook was disabled after repeated failures', { p: { webhookId: whId, reason: t.str() }, subject: ['entity', '/webhookId'], retention: 'events' }),
  ],
  capabilities: [
    read('events.list', 'Search the event log by type, subject, actor, Run, trace and time', {
      in: {
        types: t.opt(t.arr(t.str())), subject: t.opt(resourceRef), actor: t.opt(t.str()), runId: t.opt(id.run), traceId: t.opt(id.trace),
        from: t.opt(t.ts()), to: t.opt(t.ts()), ...pageIn,
      },
      out: { events: t.arr(eventRow), ...pageOut }, tool: 'meta', label: 'filter', cli: 'vyre events list',
    }),
    read('events.get', 'Read one event by id', { in: { eventId: id.event }, out: { event: eventRow }, tool: 'meta', label: 'check', cli: 'vyre events get' }),
    read('events.since', 'Events after a cursor, in order, filtered for the reader; the catch-up call behind subscribe', {
      in: { after: t.int({ minimum: 0 }), types: t.opt(t.arr(t.str())), limit: t.opt(t.int({ minimum: 1, maximum: 1000 })) },
      out: { events: t.arr(eventRow), next: t.int(), head: t.int() }, tool: 'meta', label: 'filter', cli: 'vyre events since',
    }),
    read('events.types', 'The event catalogue: names, versions, schemas, and which can start an Automation or raise a notification', {
      in: { prefix: t.opt(t.str()) },
      out: { types: t.arr(t.obj({ name: t.str(), sv: t.int(), summary: t.str(), payload: t.json(), trigger: t.bool(), notify: t.opt(t.str()) })) }, tool: 'meta',
    }),
    write('events.replay', 'Replay a failed Run, a trace, a sync conflict or an event range against a copy of the Space; outward effects are recorded, not executed', {
      in: {
        traceId: t.opt(id.trace), runId: t.opt(id.run), conflictId: t.opt(id.conflict), fromSeq: t.opt(t.int({ minimum: 1 })), toSeq: t.opt(t.int({ minimum: 1 })),
        withClearance: t.opt(t.bool()),
      },
      out: runStarted, perm: 'server.logs', level: 'manage', risk: 'high', run: { kind: 'replay', stoppable: true }, audit: 'always', tool: 'engineer', agent: { planMode: 'blocked' },
      errors: ['permission.above_clearance'],
    }),
    write('webhooks.create', 'Create an outgoing webhook for event types with an optional filter; returns the signing secret once', {
      in: { name: t.str({ minLength: 1 }), url, eventTypes: t.arr(t.str(), { minItems: 1 }), filter: t.opt(t.json()) },
      out: { webhook: webhookRow, secret: t.str({ description: 'Shown once' }) }, perm: 'connectors.manage', idem: 'key',
      emits: ['webhook.created'], audit: 'always', tool: 'engineer', cli: 'vyre webhooks create',
    }),
    read('webhooks.list', 'List outgoing webhooks', { in: { ...pageIn }, out: { webhooks: t.arr(webhookRow), ...pageOut }, perm: 'connectors.manage', tool: 'engineer', cli: 'vyre webhooks list' }),
    read('webhooks.get', 'Read one webhook', { in: target, out: { webhook: webhookRow }, perm: 'connectors.manage', tool: 'engineer' }),
    write('webhooks.update', 'Change the name, URL, event types, filter or active state of a webhook', {
      in: { ...target, name: t.opt(t.str()), url: t.opt(url), eventTypes: t.opt(t.arr(t.str(), { minItems: 1 })), filter: t.opt(t.nullable(t.json())), active: t.opt(t.bool()) },
      out: { webhook: webhookRow }, perm: 'connectors.manage', emits: ['webhook.updated'], audit: 'always', tool: 'engineer',
    }),
    write('webhooks.delete', 'Delete a webhook; pending deliveries are dropped', { in: target, out: { deleted: t.bool() }, perm: 'connectors.manage', emits: ['webhook.deleted'], audit: 'always', tool: 'engineer' }),
    write('webhooks.rotate_secret', 'Rotate the signing secret; returns the new secret once', {
      in: target, out: { secret: t.str({ description: 'Shown once' }), webhook: webhookRow }, perm: 'connectors.manage', risk: 'high', emits: ['webhook.secret_rotated'], audit: 'always', tool: 'engineer',
    }),
    read('webhooks.deliveries', 'The delivery log of a webhook: state, attempts, status code, last error', {
      in: { ...target, states: t.opt(t.arr(deliveryState)), ...pageIn }, out: { deliveries: t.arr(deliveryRow), ...pageOut }, perm: 'connectors.manage', tool: 'engineer',
    }),
    outward('webhooks.test', 'Send a sample signed event to the webhook URL and report the answer', {
      in: target, out: { delivery: deliveryRow }, perm: 'connectors.manage', gate: gateNone, emits: ['webhook.delivered', 'webhook.delivery_failed'], tool: 'engineer',
    }),
    outward('webhooks.replay_delivery', 'Send a past delivery again with the same body and a fresh signature', {
      in: { deliveryId: dlvId }, out: { delivery: deliveryRow }, perm: 'connectors.manage', gate: gateNone, emits: ['webhook.delivered', 'webhook.delivery_failed'], audit: 'always', tool: 'engineer',
    }),
    outward('webhooks.send_delivery', 'Deliver one event to one webhook with HMAC signature and trace header, retrying with backoff (called by the events.webhooks_out consumer)', {
      in: { webhookId: whId, eventId: id.event, attempt: t.int({ minimum: 1 }) }, out: { delivery: deliveryRow }, gate: gateNone,
      emits: ['webhook.delivered', 'webhook.delivery_failed', 'webhook.disabled'], idem: 'key', audit: 'none',
    }),
    read('webhooks.health', 'Cheap health probe of outgoing delivery: consumer lag and the failure rate', {
      in: {}, out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), lagEvents: t.int(), failing: t.int() },
    }),
  ],
  health: [
    health('webhooks_out', 'Outgoing webhooks', 'webhooks.health', 'Open Console > Webhooks > Deliveries, fix the failing URLs, then replay the failed deliveries.'),
  ],
  screens: [
    screen('events.webhooks', 'console', 'ui:WebhooksPage', {
      q: { webhooks: ['webhooks.list', {}, true], types: ['events.types', { prefix: '/state/prefix' }, false] },
      a: {
        create: ['webhooks.create', { name: '/draft/name', url: '/draft/url', eventTypes: '/draft/eventTypes', filter: '/draft/filter' }],
        update: ['webhooks.update', { webhookId: '/state/webhookId', name: '/draft/name', url: '/draft/url', eventTypes: '/draft/eventTypes', active: '/draft/active' }],
        delete: ['webhooks.delete', { webhookId: '/state/webhookId' }, 'Delete this webhook? Pending deliveries are dropped.'],
        rotate: ['webhooks.rotate_secret', { webhookId: '/state/webhookId' }, 'Rotate the signing secret? The old one stops working.'],
        test: ['webhooks.test', { webhookId: '/state/webhookId' }],
      },
      needs: ['connectors.manage'], empty: 'No webhooks yet', primary: 'New webhook',
    }),
    screen('events.deliveries', 'console', 'ui:DeliveryLog', {
      slot: 'side',
      q: { deliveries: ['webhooks.deliveries', { webhookId: '/state/webhookId', states: '/state/states' }, true] },
      a: { replay: ['webhooks.replay_delivery', { deliveryId: '/state/deliveryId' }] },
      needs: ['connectors.manage'], empty: 'No deliveries yet',
    }),
  ],
});
