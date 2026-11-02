// voice (Talk): speak, and the words land in the composer. Transcription only, Deepgram for now, one provider seam in lib/voice.ts. A person's own key covers them; a Space key covers everyone. Own key wins.
// DECISION: voice_session mints a short-lived provider token for the page. It is a write because it uses a Vault item, it keeps nothing (idem none) and no agent ever sees it. Each session is an audit row, so use is attributed per person.
// DECISION: a Space key sits in a Restricted Shared folder (the same way the GitHub sign-in secret does): a Member has no Use on it, so no member, agent or process can fill or read it. Members reach it only through voice.session, which names no value.
// DECISION: a key enters through a person's press only: the first-press sheet or the voice_key card. voice.connect and voice.space.connect refuse an agent. An agent may post the card, change a person's own choices for them, and ask to change the Space's, which stops at the Gate.
import { block, defineManifest, ev, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const scope = t.enm('mine', 'space');
const source = t.enm('own', 'space', 'none');
const choice = t.obj({ id: t.str({ examples: ['nova-3'] }), label: t.str() });
const providerRow = t.obj({ key: t.str({ examples: ['deepgram'] }), name: t.str(), keyUrl: t.str(), models: t.arr(choice), languages: t.arr(choice) });
const status = {
  on: t.bool(), provider: t.str({ examples: ['deepgram'] }), language: t.str({ examples: ['multi'] }), model: t.str({ examples: ['nova-3'] }),
  source, spaceOn: t.bool(), mayManage: t.bool(), providers: t.arr(providerRow),
};
const spaceRow = {
  set: t.bool(), on: t.bool(), provider: t.opt(t.str({ examples: ['deepgram'] })), itemId: t.opt(id.vaultItem), setBy: t.opt(id.user),
  checkedAt: t.opt(t.ts()), state: t.opt(t.enm('ok', 'failing')), peopleOwnKey: t.opt(t.int({ minimum: 0 })),
};
const keyIn = { provider: t.str({ examples: ['deepgram'] }), fields: t.arr(t.obj({ key: t.str({ examples: ['api_key'] }), value: t.str(), secret: t.opt(t.bool()) })) };
const providerErrors = ['provider.auth_failed', 'provider.network', 'provider.unavailable', 'provider.rate_limited'] as const;

export default defineManifest({
  id: 'voice',
  title: 'Talk',
  owner: 'L7a',

  events: [
    ev('voice.configured', 'A person\'s Talk choices changed', { p: { person: id.user, on: t.bool(), provider: t.str(), language: t.str(), model: t.str(), by: t.str() }, subject: ['entity', '/person'], vis: 'participants' }),
    ev('voice.connected', 'A Talk key was added or replaced in the Vault (no value)', { p: { scope, provider: t.str(), by: t.str() }, subject: ['entity', '/provider'], vis: 'participants' }),
    ev('voice.disconnected', 'A Talk key was removed', { p: { scope, provider: t.str(), by: t.str() }, subject: ['entity', '/provider'], vis: 'participants' }),
    ev('voice.space_changed', 'Talk for everyone in the Space was turned on or off', { p: { on: t.bool(), by: t.str() }, subject: ['entity', '/by'], retention: 'audit' }),
    ev('voice.space_checked', 'The Space key was checked with the provider', { p: { state: t.enm('ok', 'failing') }, subject: ['entity', '/state'] }),
  ],

  capabilities: [
    read('voice.status', 'Talk for the person asking: on or off, provider, language, model and what covers them (their own key, the Space key or nothing). Never a key', {
      in: {}, out: status, tool: 'meta', deferred: true, offline: 'online',
    }),
    write('voice.configure', 'Change a person\'s Talk: on or off, provider, language, model. An agent may do this for the person it acts for. Keys go through voice_ask_key', {
      in: { on: t.opt(t.bool()), provider: t.opt(t.str({ examples: ['deepgram'] })), language: t.opt(t.str({ examples: ['es'] })), model: t.opt(t.str({ examples: ['nova-3'] })) },
      out: status, emits: ['voice.configured'], tool: 'meta', deferred: true, offline: 'online',
    }),
    write('voice.connect', 'A person adds or replaces their own Talk key: it is checked with the provider at once, then kept in their Mine folder. A person does this, never an agent', {
      idem: 'key', in: keyIn, out: status, emits: ['voice.connected'], audit: 'sensitive', offline: 'online', agent: false, errors: [...providerErrors],
    }),
    write('voice.disconnect', 'A person removes their own Talk key from the Vault', { in: {}, out: status, emits: ['voice.disconnected'], audit: 'sensitive', offline: 'online', agent: false }),
    write('voice.session', 'Open one Talk session: mints a short-lived provider token and the socket address. Own key first, then the Space key. Audited per person; the key itself never leaves the server', {
      idem: 'none', in: {}, out: { provider: t.str({ examples: ['deepgram'] }), url: t.str(), protocols: t.arr(t.str()), source: t.enm('own', 'space'), expiresIn: t.int({ minimum: 1 }) },
      audit: 'always', offline: 'online', agent: false, rate: { n: 120, perSeconds: 60, scope: 'principal' }, errors: [...providerErrors, 'validation.precondition_failed'],
    }),
    write('voice.ask_key', 'Post the secret card that asks for a Talk key in this chat: their own, or the Space\'s. The value goes straight to the Vault and never into the chat', {
      in: { scope: t.opt(scope), provider: t.opt(t.str({ examples: ['deepgram'] })) }, out: { ok: t.bool() }, tool: 'meta', deferred: true, offline: 'online', errors: ['validation.precondition_failed'],
    }),

    read('voice.space.status', 'Talk for everyone in the Space: whether a key is set, on or off, who set it, when it was last checked and how many people use their own key', {
      in: {}, out: spaceRow, perm: 'policy.manage', tool: 'meta', deferred: true, offline: 'online',
    }),
    write('voice.space.connect', 'An admin adds or replaces the key that covers everyone: it is checked at once, then kept in a Restricted Shared folder. A person does this, never an agent', {
      idem: 'key', in: keyIn, out: spaceRow, perm: 'policy.manage', emits: ['voice.connected', 'voice.space_changed'], audit: 'always', offline: 'online', agent: false, errors: [...providerErrors],
    }),
    write('voice.space.configure', 'Turn Talk for everyone on or off, and keep the key. An agent\'s change stops at the Gate for someone who may approve it', {
      in: { on: t.bool() }, out: spaceRow, perm: 'policy.manage', gate: { act: 'approve', when: "actor.kind != 'person'", reason: 'Changes Talk for everyone in the Space' }, emits: ['voice.space_changed'], audit: 'always', tool: 'meta', deferred: true, offline: 'online', errors: ['validation.precondition_failed'],
    }),
    write('voice.space.check', 'Check the Space key with the provider now', { in: {}, out: spaceRow, perm: 'policy.manage', emits: ['voice.space_checked'], tool: 'meta', deferred: true, offline: 'online', errors: ['validation.precondition_failed'] }),
    write('voice.space.disconnect', 'Remove the Space key from the Vault; people with their own key keep working', {
      in: {}, out: spaceRow, perm: 'policy.manage', gate: { act: 'delete', when: "actor.kind != 'person'" }, emits: ['voice.disconnected'], audit: 'always', offline: 'online', agent: false,
    }),
  ],

  screens: [
    screen('console.ai-voice', 'console', 'ui:ConsoleAiVoice', {
      q: { space: ['voice.space.status', {}, true], me: ['voice.status', {}, true] },
      a: { configure: ['voice.space.configure', {}], check: ['voice.space.check', {}] },
      needs: ['policy.manage'],
    }),
  ],

  blocks: [
    block('voice_key', { provider: t.str({ examples: ['deepgram'] }), scope, hint: t.opt(t.str()) }, 'Add a Talk key: type it in the field above. It goes straight to the Vault and does not enter this chat.', {
      actions: [
        { key: 'save', label: 'Turn on Talk', cap: 'voice.connect', input: { provider: '/provider' } },
        { key: 'save_space', label: 'Turn on for everyone', cap: 'voice.space.connect', input: { provider: '/provider' } },
      ],
    }),
  ],
});
