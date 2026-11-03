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
    write('browser.sites.remove', 'Remove a Browser connection', { level: 'member', in: { siteId }, out: ok, emits: ['browser.site_changed'], audit: 'sensitive', offline: 'online', errors: ['validation.not_found'] }),
  ],
});
