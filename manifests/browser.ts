// browser (lane l-chrome2a): the Browser connections of Vault > Connections. A person says which sites agents may use, where each site runs (My Chrome, an agent's computer, or both), and
// what each agent may do there: Read only, or Act (a send, a post, a payment or a delete is always held for the person, whatever the right). Rows are the person's own.
// DECISION: a site with no row can be read by an agent in My Chrome and never acted on; a Read only agent is refused an act with words that say where to change it.
// DECISION: an agent never sets or widens its own rights: set and remove are the signed-in person's. An agent (the Chrome in an agent's computer is signed in as the agent) lists the sites that name it.
// DECISION: the extension reads this list; it never stores it (apps/chrome keeps a short cache in memory only). The watches of the Watch sheet (lane l-chrome2b) are capabilities of this same module.
import { defineManifest, ev, read, t, write } from '../packages/contracts/src/index.ts';
import { id, ok } from './_common.ts';

const siteId = t.id('bsi');
const runsIn = t.enm('chrome', 'computers', 'both');
const right = t.enm('read', 'act');
const rightRow = t.obj({ agentId: id.agent, right });
const siteRow = t.obj({
  id: siteId, host: t.str({ examples: ['app.gohighlevel.com'] }), runsIn, rights: t.arr(rightRow), at: t.ts(), updatedAt: t.ts(),
});

export default defineManifest({
  id: 'browser',
  title: 'Browser connections',
  owner: 'L10',

  events: [
    ev('browser.site_changed', 'A Browser connection was added, changed or removed', { p: { siteId, host: t.str(), runsIn, removed: t.bool() }, subject: ['entity', '/siteId'], vis: 'participants' }),
  ],

  capabilities: [
    read('browser.sites.list', 'The Browser connections: sites agents may use, where each runs, and each agent\'s right (Read only or Act). A person sees their own; an agent sees the sites that name it', {
      level: 'member', out: { sites: t.arr(siteRow) }, tool: 'computer', agent: { planMode: 'allowed' }, offline: 'online',
    }),
    write('browser.sites.set', 'Add a Browser connection, or change one: where it runs and which agents may Read only or Act. Sends, posts, payments and deletes are always held for you', {
      level: 'member', idem: 'key', in: { host: t.str({ examples: ['app.gohighlevel.com'] }), runsIn, rights: t.arr(rightRow) }, out: { site: siteRow },
      emits: ['browser.site_changed'], audit: 'sensitive', offline: 'online', errors: ['validation.precondition_failed'],
    }),
    // The two Chrome cards in a chat (chrome_held, chrome_step): a host-written block, cleaned to the page's own fields and posted as the caller with no text and no mention, so it never wakes an agent.
    write('browser.cards.post', 'Leave a card in a chat for work in the person\'s own Chrome: a held send with the page\'s To, From, Subject and Message, or the "Using your Chrome" step with a masked picture. Never routes to an agent', {
      level: 'member', idem: 'key', in: { threadId: id.thread, block: t.obj({ type: t.enm('chrome_held', 'chrome_step'), data: t.json() }) }, out: { posted: t.bool() }, audit: 'none', offline: 'online', errors: ['validation.bad_input'],
    }),
    // What the buttons on those cards do. Only the signed-in person, only in their own Chrome: Send releases the held item through chrome_send (once: a second press says it was already done), Don't send makes the
    // extension forget it and tells the agent in the chat, Watch brings its tab to the front, Take over gives the tab back.
    write('browser.chrome.act', 'Press a button on a Chrome card: send what is held, do not send it, watch the agent\'s tab, or take it over', {
      level: 'member', idem: 'key', risk: 'high', in: { action: t.enm('send', 'drop', 'watch', 'takeover'), agentId: id.agent, heldId: t.opt(t.str({ pattern: '^hld_[0-9a-f]+$', examples: ['hld_a1b2c3'] })), threadId: t.opt(id.thread), summary: t.opt(t.str()) },
      out: { done: t.bool(), already: t.opt(t.bool()) }, audit: 'always', offline: 'online', errors: ['provider.unavailable', 'validation.bad_input', 'permission.no_grant'],
    }),
    write('browser.sites.remove', 'Remove a Browser connection', { level: 'member', in: { siteId }, out: ok, emits: ['browser.site_changed'], audit: 'sensitive', offline: 'online', errors: ['validation.not_found'] }),
  ],
});
