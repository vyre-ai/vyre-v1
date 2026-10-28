// forms (lane L8): forms, one-use links, booking pages, surveys, attribution (spec 2.11, 3.6, ARCH 7.6). May land after the window.
import { create, defineManifest, ev, list, read, screen, step, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const slug = t.str({ pattern: '^[a-z0-9-]+$', examples: ['intake'] });
const fieldMode = t.enm('ask', 'show', 'hide');
const formRow = t.obj({ formId: id.form, name: t.str(), recordType: id.recordType, kind: t.enm('public', 'one_use', 'booking', 'survey'), state: t.enm('draft', 'published', 'closed'), slug, submissions: t.int() });
const attribution = t.obj({ utmSource: t.opt(t.str()), utmMedium: t.opt(t.str()), utmCampaign: t.opt(t.str()), clickIds: t.opt(t.rec(t.str())), referrer: t.opt(t.str()), landingPage: t.opt(t.str()), device: t.opt(t.str()), location: t.opt(t.str()), consent: t.bool() });
const bookingRow = t.obj({ bookingId: t.id('bkg'), formId: id.form, recordId: id.record, startsAt: t.ts(), endsAt: t.ts(), hostId: id.user, state: t.enm('booked', 'cancelled', 'rescheduled') });
const target = { formId: id.form };

export default defineManifest({
  id: 'forms',
  title: 'Forms and bookings',
  owner: 'L8',
  events: [
    ev('form.created', 'A form was created as a draft', { p: { formId: id.form, name: t.str(), kind: t.str() }, subject: ['form', '/formId'] }),
    ev('form.published', 'A form went live', { p: { formId: id.form, slug }, subject: ['form', '/formId'] }),
    ev('form.submitted', 'A form was submitted; the record was written with source link holder', { p: { formId: id.form, recordId: id.record, type: id.recordType, matched: t.bool() }, subject: ['form', '/formId'], trigger: { title: 'A form is submitted', fields: ['/formId'] } }),
    ev('form.link_created', 'A one-use or signed record link was made', { p: { formId: id.form, recordId: id.record, expiresAt: t.opt(t.ts()) }, subject: ['form', '/formId'] }),
    ev('booking.created', 'A booking was made; a record and a meeting were created or updated', { p: { bookingId: t.id('bkg'), formId: id.form, recordId: id.record }, subject: ['form', '/formId'], trigger: { title: 'A booking is made' } }),
    ev('booking.cancelled', 'A booking was cancelled', { p: { bookingId: t.id('bkg'), formId: id.form }, subject: ['form', '/formId'] }),
  ],
  lists: [list('form', 'Form', 'Forms', 'forms.list')],
  capabilities: [
    create('forms.create', 'Create a form on a record type; every input maps to a field', { in: { name: t.str(), recordType: id.recordType, kind: t.enm('public', 'one_use', 'booking', 'survey') }, out: { form: formRow }, make: ['form', '/recordType'], perm: 'forms.publish', emits: ['form.created'], tool: 'automations' }),
    read('forms.get', 'Read a form with its field modes, layout, theme and logic', { in: target, out: { form: formRow, fields: t.arr(t.obj({ field: t.str(), mode: fieldMode, prefillKey: t.opt(t.str()) })), theme: t.opt(t.rec()), logic: t.opt(t.json()) }, on: ['form', '/formId'], tool: 'automations' }),
    read('forms.list', 'List forms by section and folder', { in: { section: t.opt(t.enm('personal', 'shared', 'space')), folderId: t.opt(id.folder), ...pageIn }, out: { forms: t.arr(formRow), ...pageOut }, tool: 'automations' }),
    write('forms.update', 'Change form name, match rule, consent text, captcha toggle, upload policy and rate limits', { in: { formId: id.form, name: t.opt(t.str()), matchRule: t.opt(t.arr(t.str())), consentText: t.opt(t.str()), captcha: t.opt(t.bool()), uploadPolicy: t.opt(t.rec()), rateLimit: t.opt(t.int()) }, out: { form: formRow }, on: ['form', '/formId'], perm: 'forms.publish', tool: 'automations' }),
    write('forms.fields_set', 'Set Ask, Show or Hide per field, prefill keys and multi-step grouping', { in: { formId: id.form, fields: t.arr(t.obj({ field: t.str(), mode: fieldMode, prefillKey: t.opt(t.str()), step: t.opt(t.int()) })) }, out: { ok: t.bool() }, on: ['form', '/formId'], perm: 'forms.publish', tool: 'automations' }),
    write('forms.design_set', 'Set layout, theme, fonts, custom CSS, cover image, conditional logic and thank-you page or redirect', { in: { formId: id.form, theme: t.opt(t.rec()), css: t.opt(t.str()), logic: t.opt(t.json()), thankYou: t.opt(t.obj({ text: t.opt(t.str()), redirect: t.opt(t.str()) })) }, out: { ok: t.bool() }, on: ['form', '/formId'], perm: 'forms.publish', tool: 'automations' }),
    write('forms.publish', 'Publish a form as a public link or embed', { in: { formId: id.form }, out: { url: t.str(), embed: t.str() }, on: ['form', '/formId'], perm: 'forms.publish', level: 'manage', emits: ['form.published'], tool: 'automations', team: true, audit: 'sensitive' }),
    write('forms.unpublish', 'Close a form', { in: target, out: { ok: t.bool() }, on: ['form', '/formId'], perm: 'forms.publish', level: 'manage', tool: 'automations' }),
    write('forms.delete', 'Delete a form', { in: target, out: { deleted: t.bool() }, on: ['form', '/formId'], perm: 'forms.publish', level: 'manage', gate: { act: 'delete', when: "actor.kind != 'person'" }, tool: 'automations' }),
    create('forms.link_create', 'Make a signed or one-use form link for one record that asks only for the missing fields (no emails in URLs)', { in: { formId: id.form, recordId: id.record, singleUse: t.bool(), expiresInHours: t.opt(t.int({ minimum: 1 })) }, out: { url: t.str(), expiresAt: t.opt(t.ts()) }, on: ['form', '/formId'], perm: 'forms.publish', emits: ['form.link_created'], tool: 'automations', team: true }),
    write('forms.link_revoke', 'Revoke a one-use link', { in: { formId: id.form, token: t.str() }, out: { revoked: t.bool() }, on: ['form', '/formId'], perm: 'forms.publish', tool: 'automations' }),
    create('forms.submit', 'Public submit: writes through as principal svc_form_<id> with source link holder; consent, captcha and rate limits apply; attribution captured', {
      in: { slug, answers: t.rec(), attribution: t.opt(attribution), token: t.opt(t.str()), code: t.opt(t.str()), captcha: t.opt(t.str()) },
      out: { recordId: id.record, thankYou: t.opt(t.str()) }, emits: ['form.submitted'], http: { method: 'POST', path: '/f/submit' }, team: true,
      errors: ['rate_limit.exceeded', 'validation.duplicate', 'auth.invalid_code'], rate: { n: 20, perSeconds: 60, scope: 'space' },
    }),
    read('forms.submissions', 'List submissions of a form', { in: { formId: id.form, ...pageIn }, out: { rows: t.arr(t.obj({ recordId: id.record, at: t.ts(), matched: t.bool() })), ...pageOut }, on: ['form', '/formId'], tool: 'automations' }),
    read('forms.survey_results', 'Aggregate results of a survey', { in: target, out: { responses: t.int(), questions: t.arr(t.obj({ field: t.str(), summary: t.json() })) }, on: ['form', '/formId'], tool: 'automations' }),
    read('forms.attribution_get', 'First source and Latest source of a record', { in: { recordId: id.record }, out: { first: t.opt(attribution), latest: t.opt(attribution) }, on: ['record', '/recordId'], tool: 'records' }),
    read('source_rules.list', 'List Source rules that map clicks to channels', { out: { rules: t.arr(t.obj({ ruleId: t.id('srl'), match: t.json(), channel: t.str(), order: t.int() })) }, tool: 'automations' }),
    write('source_rules.set', 'Replace the Source rules', { in: { rules: t.arr(t.obj({ match: t.json(), channel: t.str() })) }, out: { ok: t.bool() }, perm: 'forms.publish', level: 'manage', tool: 'automations' }),
    create('bookings.page_create', 'Create a booking page with host or round-robin pool, length, buffer and questions', { in: { name: t.str(), hostIds: t.arr(id.user), lengthMinutes: t.int({ minimum: 5 }), bufferMinutes: t.opt(t.int({ minimum: 0 })), recordType: id.recordType }, out: { form: formRow }, make: ['form', '/recordType'], perm: 'forms.publish', emits: ['form.created'], tool: 'automations', team: true }),
    read('bookings.availability', 'Open slots in the visitor time zone from connected calendars; unavailable when the host is disconnected', { in: { slug, tz: t.str({ examples: ['America/Los_Angeles'] }), from: t.ts(), to: t.ts() }, out: { slots: t.arr(t.obj({ startsAt: t.ts(), endsAt: t.ts(), hostId: id.user })), available: t.bool() }, http: { method: 'GET', path: '/book/availability' }, team: true }),
    create('bookings.book', 'Public: make a booking; creates or updates a record and a meeting', { in: { slug, startsAt: t.ts(), answers: t.rec(), tz: t.str() }, out: { booking: bookingRow }, emits: ['booking.created'], http: { method: 'POST', path: '/book/create' }, team: true, rate: { n: 10, perSeconds: 60, scope: 'space' } }),
    write('bookings.cancel', 'Cancel a booking', { in: { bookingId: t.id('bkg') }, out: { booking: bookingRow }, emits: ['booking.cancelled'], tool: 'automations' }),
    read('bookings.list', 'List bookings of a page', { in: { formId: id.form, ...pageIn }, out: { bookings: t.arr(bookingRow), ...pageOut }, on: ['form', '/formId'], tool: 'automations' }),
    write('forms.save_partial', 'Public: keep the answers typed so far against a signed or one-use link so the person can come back; nothing reaches the record until submit', {
      in: { slug, token: t.str(), answers: t.rec(), step: t.opt(t.int({ minimum: 0 })) }, out: { saved: t.bool(), expiresAt: t.opt(t.ts()) },
      http: { method: 'POST', path: '/f/partial' }, team: true, rate: { n: 60, perSeconds: 60, scope: 'space' },
    }),
  ],
  steps: [
    step('forms.list', 'Forms · List forms', 'data', 'capability', {
      cap: 'forms.list', effects: 'read',
      in: { section: t.opt(t.enm('personal', 'shared', 'space')), folderId: t.opt(id.folder) },
      out: { forms: t.arr(formRow) },
    }),
    step('forms.create', 'Forms · Create a form', 'data', 'capability', {
      cap: 'forms.create', effects: 'write', idempotency: 'key',
      in: { name: t.str(), recordType: id.recordType, kind: t.enm('public', 'one_use', 'booking', 'survey') },
      out: { form: formRow },
    }),
    step('forms.publish', 'Forms · Publish a form', 'send', 'capability', {
      cap: 'forms.publish', effects: 'write', idempotency: 'key',
      in: { formId: id.form },
      out: { url: t.str(), embed: t.str() },
    }),
  ],
  screens: [
    screen('apps.forms', 'apps', 'ui:FormsList', { q: { forms: ['forms.list', { section: '/section', folderId: '/folder' }], submissions: ['forms.submissions', { formId: '/selected' }] }, a: { create: ['forms.create'], publish: ['forms.publish', { formId: '/selected' }] }, empty: 'No forms yet', primary: 'New form', needs: ['forms.publish'] }),
    screen('apps.form-settings', 'apps', 'ui:FormSettings', { slot: 'side', q: { form: ['forms.get', { formId: '/selected' }] }, a: { fields: ['forms.fields_set', { formId: '/selected' }], design: ['forms.design_set', { formId: '/selected' }] } }),
  ],
});
