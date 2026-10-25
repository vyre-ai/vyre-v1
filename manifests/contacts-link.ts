// contacts-link (lane L5): record types contact and company, contact preferences, the suppression list,
// DND screening (adds only), duplicate suggestions, address index and owner routing. Spec 2.18, 2.19, 2.9.
// DECISION: capability segments are lower snake case, so the module prefix is `contacts.` (ARCHITECTURE 8.2 writes
// `contacts-link.dnd_screen`; here it is `contacts.dnd_screen`).
// DECISION: a record has one primary email and one primary phone field; every further email, phone and handle lives in
// the `contact_address` entity, which the matcher reads. No multi-value email or phone field type exists in records.ts.
import { defineManifest, entity, ev, field, read, rtype, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const phone = t.str({ pattern: '^\\+[1-9][0-9]{6,14}$', examples: ['+14155550123'] });
const channel = t.enm('email', 'sms', 'call');
const reason = t.enm('bounce_hard', 'complaint', 'unsubscribe', 'stop', 'manual', 'do_not_contact', 'import');
const supId = t.id('sup');
const adrId = t.id('adr');
const contactOrCompany = t.enm('contact', 'company');

const supRow = t.obj({
  id: supId, channel, address: t.str({ description: 'Normalised email address or E.164 number', examples: ['maya@example.com'] }),
  reason, source: t.str({ examples: ['mail.bounce'] }), contactId: t.opt(id.record), addedAt: t.ts(), addedBy: t.str(), note: t.opt(t.str()),
});
const addrRow = t.obj({ id: adrId, contactId: id.record, kind: t.enm('email', 'phone', 'handle'), value: t.str(), primary: t.bool(), verified: t.bool() });
const prefs = {
  emailConsent: t.enm('granted', 'denied', 'unknown'), smsConsent: t.enm('granted', 'denied', 'unknown'), doNotContact: t.bool(),
  optedOut: t.arr(channel), source: t.opt(t.str()), at: t.opt(t.ts()),
};
const candidate = t.obj({ recordId: id.record, type: contactOrCompany, name: t.str(), via: t.enm('address', 'phone', 'handle', 'name'), score: t.num({ minimum: 0, maximum: 1 }) });

export default defineManifest({
  id: 'contacts-link',
  title: 'Contacts and consent',
  owner: 'L5',
  recordTypes: [
    rtype('contact', 'Contact', 'Contacts', 'user', [
      field('name', 'text', 'Name', { required: true }),
      field('title', 'text', 'Job title'),
      field('email', 'email', 'Email'),
      field('phone', 'phone', 'Phone'),
      field('company', 'relation', 'Company', { options: { target: 'company', inverse: 'contacts' } }),
      field('owner', 'person', 'Owner', { default: { expr: 'actor.id' } }),
      field('deliverability', 'choice', 'Deliverability', { default: 'good', options: { choices: [{ key: 'good', title: 'Good' }, { key: 'risky', title: 'Risky' }, { key: 'bounced', title: 'Bounced' }, { key: 'complained', title: 'Complained' }] } }),
      field('pref_email_consent', 'choice', 'Email consent', { default: 'unknown', options: { choices: [{ key: 'granted', title: 'Granted' }, { key: 'denied', title: 'Denied' }, { key: 'unknown', title: 'Unknown' }] } }),
      field('pref_sms_consent', 'choice', 'SMS consent', { default: 'unknown', options: { choices: [{ key: 'granted', title: 'Granted' }, { key: 'denied', title: 'Denied' }, { key: 'unknown', title: 'Unknown' }] } }),
      field('pref_do_not_contact', 'checkbox', 'Do not contact', { default: false }),
      field('pref_opt_outs', 'multichoice', 'Channel opt-outs', { options: { choices: [{ key: 'email', title: 'Email' }, { key: 'sms', title: 'Text' }, { key: 'call', title: 'Calls' }] } }),
      field('pref_source', 'text', 'Preference source'),
      field('pref_at', 'datetime', 'Preference time'),
    ], { ownerField: 'owner', summaryField: 'company', group: 'People', attribution: true }),
    rtype('company', 'Company', 'Companies', 'building', [
      field('name', 'text', 'Name', { required: true }),
      field('website', 'url', 'Website'),
      field('phone', 'phone', 'Phone'),
      field('address', 'address', 'Address'),
      field('owner', 'person', 'Owner', { default: { expr: 'actor.id' } }),
      field('contacts', 'relation', 'People', { options: { target: 'contact', inverse: 'company' } }),
    ], { ownerField: 'owner', group: 'People', attribution: true }),
  ],
  entities: [
    entity('suppression', 'contacts_link_suppression', 'sup_', { channel: 'choice', address: 'text', reason: 'choice', source: 'text', contactId: 'text', addedAt: 'datetime', addedBy: 'text', note: 'text' }, 'space', {
      sync: { profile: { desktop: 'none', phone: 'none', web: 'none' } },
    }),
    entity('contact_address', 'contacts_link_address', 'adr_', { contactId: 'text', kind: 'choice', value: 'text', normalized: 'text', primary: 'checkbox', verified: 'checkbox' }, 'record', { parentField: 'contactId' }),
  ],
  events: [
    ev('contact.preferences_changed', 'Consent, Do-not-contact or channel opt-outs changed', { p: { contactId: id.record, changed: t.arr(t.str()), source: t.str() }, subject: ['record', '/contactId'], label: 'subject', trigger: { title: "A contact's preferences change" } }),
    ev('contact.address_added', 'An email, phone or handle was added to a contact', { p: { contactId: id.record, kind: t.enm('email', 'phone', 'handle'), addressId: adrId }, subject: ['record', '/contactId'], label: 'subject' }),
    ev('contact.address_removed', 'An email, phone or handle was removed from a contact', { p: { contactId: id.record, kind: t.enm('email', 'phone', 'handle'), addressId: adrId }, subject: ['record', '/contactId'], label: 'subject' }),
    ev('contact.dnd_screened', 'A Do-not-contact screening ran over new adds (never removes anyone)', { p: { context: t.enm('audience', 'campaign', 'journey_enrol', 'import'), contextId: t.opt(t.str()), screened: t.int(), refused: t.int() }, subject: ['entity', '/context'], vis: 'space' }),
    ev('suppression.added', 'An address was added to the suppression list', { p: { suppressionId: supId, channel, reason, contactId: t.opt(id.record) }, subject: ['entity', '/suppressionId'], trigger: { title: 'An address is suppressed', fields: ['/channel', '/reason'] } }),
    ev('suppression.removed', 'An address was removed from the suppression list by a person', { p: { suppressionId: supId, channel, reason, contactId: t.opt(id.record) }, subject: ['entity', '/suppressionId'] }),
  ],
  capabilities: [
    read('contacts.resolve', 'Find the contact or company that owns an email, phone or handle (sure and unsure matches)', {
      in: { email: t.opt(t.str({ examples: ['maya@example.com'] })), phone: t.opt(phone), handle: t.opt(t.str()), name: t.opt(t.str()) },
      out: { sure: t.arr(candidate), unsure: t.arr(candidate) }, tool: 'inbox', label: 'filter',
    }),
    read('contacts.address.list', 'List every email, phone and handle held by a contact', { in: { contactId: id.record }, out: { addresses: t.arr(addrRow) }, on: ['record', '/contactId'], tool: 'inbox', label: 'check' }),
    write('contacts.address.add', 'Add an email, phone or handle to a contact', {
      in: { contactId: id.record, kind: t.enm('email', 'phone', 'handle'), value: t.str({ examples: ['maya@example.com'] }), primary: t.opt(t.bool()) },
      out: { address: addrRow }, on: ['record', '/contactId'], perm: 'records.edit', emits: ['contact.address_added'], idem: 'key', tool: 'inbox', offline: 'queue', errors: ['validation.duplicate'],
    }),
    write('contacts.address.remove', 'Remove an email, phone or handle from a contact', {
      in: { contactId: id.record, addressId: adrId }, out: { removed: t.bool() }, on: ['record', '/contactId'], perm: 'records.edit', emits: ['contact.address_removed'], tool: 'inbox', offline: 'queue',
    }),
    write('contacts.address.set_primary', 'Make one address the primary email or phone of a contact', {
      in: { contactId: id.record, addressId: adrId }, out: { address: addrRow }, on: ['record', '/contactId'], perm: 'records.edit', tool: 'inbox',
    }),
    read('contacts.preferences.get', 'Read the Contact preferences group of a contact', { in: { contactId: id.record }, out: prefs, on: ['record', '/contactId'], tool: 'inbox', label: 'check' }),
    write('contacts.preferences.set', 'Set consent, Do-not-contact and channel opt-outs (source and time are stamped)', {
      in: {
        contactId: id.record, emailConsent: t.opt(prefs.emailConsent), smsConsent: t.opt(prefs.smsConsent), doNotContact: t.opt(t.bool()),
        optedOut: t.opt(prefs.optedOut), source: t.opt(t.str({ examples: ['form'] })),
      },
      out: prefs, on: ['record', '/contactId'], perm: 'records.edit', emits: ['contact.preferences_changed'], tool: 'inbox', offline: 'queue',
    }),
    read('contacts.deliverability', 'Deliverability badge of a contact: good, risky, bounced or complained', {
      in: { contactId: id.record }, out: { state: t.enm('good', 'risky', 'bounced', 'complained'), lastEventAt: t.opt(t.ts()), reasons: t.arr(t.str()) },
      on: ['record', '/contactId'], tool: 'inbox', label: 'check',
    }),
    read('contacts.route_owner', 'Who receives an unowned reply: contact owner, then campaign owner, then the shared inbox', {
      in: { contactId: t.opt(id.record), campaignId: t.opt(id.campaign), mailboxId: t.opt(id.mailbox) },
      out: { ownerId: t.opt(id.user), via: t.enm('owner', 'campaign_owner', 'shared_inbox'), mailboxId: t.opt(id.mailbox) },
    }),
    read('contacts.suppression.list', 'List the suppression list', {
      in: { channel: t.opt(channel), reason: t.opt(reason), query: t.opt(t.str()), ...pageIn }, out: { rows: t.arr(supRow), ...pageOut }, perm: null, tool: 'inbox', label: 'filter',
    }),
    read('contacts.suppression.check', 'Check addresses against the suppression list (the single send API calls this for every sender)', {
      in: { channel, addresses: t.arr(t.str(), { minItems: 1 }) }, out: { suppressed: t.arr(t.obj({ address: t.str(), reason })) }, tool: 'inbox',
    }),
    write('contacts.suppression.add', 'Add addresses to the suppression list (bounces, complaints, opt-outs and manual adds)', {
      in: { channel, addresses: t.arr(t.str(), { minItems: 1 }), reason, source: t.opt(t.str()), note: t.opt(t.str()) },
      out: { added: t.int(), rows: t.arr(supRow) }, perm: 'records.create', emits: ['suppression.added'], idem: 'natural', tool: 'inbox',
    }),
    write('contacts.suppression.remove', 'Take an address off the suppression list (a person decision, audited)', {
      in: { suppressionId: supId, note: t.opt(t.str()) }, out: { removed: t.bool() }, perm: 'records.delete', risk: 'high', emits: ['suppression.removed'], audit: 'always', tool: 'inbox',
      errors: ['validation.precondition_failed'],
    }),
    write('contacts.suppression.import', 'Add many addresses from a file to the suppression list', {
      in: { channel, fileId: id.file, reason: t.opt(reason) }, out: { added: t.int(), skipped: t.int() }, perm: 'records.create', emits: ['suppression.added'], idem: 'key', tool: 'inbox',
    }),
    write('contacts.apply_optout', 'Apply an inbound STOP or UNSUBSCRIBE: suppress the address and set the contact preferences', {
      in: { channel, address: t.str(), keyword: t.str({ examples: ['STOP'] }), source: t.enm('sms_stop', 'email_unsubscribe', 'link', 'reply'), at: t.opt(t.ts()) },
      out: { suppressionId: supId, contactId: t.opt(id.record) }, emits: ['suppression.added', 'contact.preferences_changed'], idem: 'natural',
    }),
    read('contacts.dnd_screen', "Screen candidates before they are ADDED to an audience, campaign, Journey enrolment or import. Adds only: it never removes, unsubscribes or deletes anyone already present", {
      in: {
        context: t.enm('audience', 'campaign', 'journey_enrol', 'import'), contextId: t.opt(t.str()),
        candidates: t.arr(t.obj({ ref: t.str(), contactId: t.opt(id.record), email: t.opt(t.str()), phone: t.opt(phone) }), { minItems: 1 }),
      },
      out: { allowed: t.arr(t.str()), refused: t.arr(t.obj({ ref: t.str(), reason })), removed: t.int({ maximum: 0, description: 'Always 0: screening never removes anyone' }) },
      tool: 'inbox', audit: 'always', ex: { output: { allowed: ['ref_1'], refused: [{ ref: 'ref_2', reason: 'do_not_contact' }], removed: 0 } },
    }),
    read('contacts.duplicates.list', 'Likely duplicate contacts or companies, with the reasons', {
      in: { type: t.opt(contactOrCompany), ...pageIn },
      out: { suggestions: t.arr(t.obj({ suggestionId: t.str(), type: contactOrCompany, ids: t.arr(id.record, { minItems: 2 }), score: t.num(), reasons: t.arr(t.str()) })), ...pageOut },
      tool: 'records', label: 'filter',
    }),
    write('contacts.duplicates.dismiss', 'Mark a suggested pair as not duplicates', { in: { suggestionId: t.str() }, out: { dismissed: t.bool() }, perm: 'records.edit', tool: 'records' }),
  ],
  screens: [
    screen('contacts.duplicates', 'records', 'ui:DuplicateSuggestions', {
      q: { suggestions: ['contacts.duplicates.list', { type: '/state/type' }, true] },
      a: { merge: ['records.merge', { type: '/state/type', survivorId: '/state/survivorId', mergedIds: '/state/mergedIds', picks: '/state/picks' }, 'Merge these records? You can undo for 30 days.'], dismiss: ['contacts.duplicates.dismiss', { suggestionId: '/state/suggestionId' }] },
      empty: 'No likely duplicates', needs: ['records.delete'],
    }),
    screen('contacts.preferences', 'records', 'ui:ContactPreferences', {
      slot: 'tab',
      q: { prefs: ['contacts.preferences.get', { contactId: '/state/contactId' }, true], addresses: ['contacts.address.list', { contactId: '/state/contactId' }, true], deliverability: ['contacts.deliverability', { contactId: '/state/contactId' }, true] },
      a: { set: ['contacts.preferences.set', { contactId: '/state/contactId', emailConsent: '/state/emailConsent', smsConsent: '/state/smsConsent', doNotContact: '/state/doNotContact', optedOut: '/state/optedOut' }], add: ['contacts.address.add', { contactId: '/state/contactId', kind: '/state/kind', value: '/state/value' }], remove: ['contacts.address.remove', { contactId: '/state/contactId', addressId: '/state/addressId' }] },
      empty: 'No preferences set',
    }),
    screen('contacts.suppression', 'console', 'ui:SuppressionList', {
      q: { rows: ['contacts.suppression.list', { channel: '/state/channel', reason: '/state/reason', query: '/state/query' }, true] },
      a: { add: ['contacts.suppression.add', { channel: '/state/channel', addresses: '/state/addresses', reason: '/state/reason' }], remove: ['contacts.suppression.remove', { suppressionId: '/state/suppressionId' }, 'Take this address off the suppression list?'] },
      empty: 'Nobody is suppressed', needs: ['records.delete'],
    }),
  ],
  settings: [
    setting('contacts.dnd_screening', 'space', 'comms', 'Screen new adds against Do-not-contact', t.bool(), true),
    setting('contacts.sms_requires_consent', 'space', 'comms', 'Require SMS consent before texting', t.bool(), true),
    setting('contacts.optout_keywords', 'space', 'comms', 'Words that opt a contact out', t.arr(t.str()), ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']),
  ],
});
