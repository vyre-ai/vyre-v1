// settings (lane L7a): the settings rows registry (settings.get, set, search), Copy from another Space and the Kit choice.
// The registry is generated from every module's settings[]; this module owns the read and write capabilities and the person rows
// for Profile, Appearance and Keyboard. Other modules own the rows that belong to them (notifications, models, memory, connections).
// DECISION: a setting value is opaque JSON validated by the SettingDef schema at call time, so value is t.json() here.
// DECISION: person-scope settings are per Space (each Space keeps its own profile and rules); Appearance skin is personal per Space.
// DECISION: Copy from another Space is two halves: copy_source reads the exportable profile through that other Space's session, copy_profile applies it here. Title is never copied.
import { defineManifest, ev, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import { id } from './_common.ts';

const V = { level: 'view' } as const;
const scope = t.enm('space', 'person');
const settingRow = t.obj({
  key: t.str({ examples: ['profile.timezone'] }), scope, page: t.str({ examples: ['profile'] }), title: t.str(), value: t.json(), default: t.json(),
  source: t.enm('default', 'space', 'person'), floorable: t.bool(), floor: t.opt(t.json()),
});
// a real key in the examples of the capabilities that take one (the generated examples read the schema's first example); event payloads stay as frozen
const key = t.str({ examples: ['appearance.mode'] });
const copyFields = t.enm('photo', 'name', 'handle', 'timezone', 'hours', 'contact');
const kitChoice = t.obj({ space: t.nullable(id.kit), person: t.nullable(id.kit), effective: id.kit });

export default defineManifest({
  id: 'settings',
  title: 'Settings',
  owner: 'L7a',

  events: [
    ev('settings.changed', 'A setting changed (settings hold no secrets)', { p: { key: t.str(), scope, person: t.opt(id.user), before: t.json(), after: t.json(), by: t.str() }, subject: ['entity', '/key'] }),
    ev('settings.floor_changed', 'The owner floor on a setting changed; nobody may go below it', { p: { key: t.str(), by: t.str() }, subject: ['entity', '/key'], retention: 'audit' }),
  ],

  capabilities: [
    read('settings.pages', 'The ten settings pages in their two groups (named after the Space, and Everywhere) with row counts', {
      ...V, in: {}, out: { pages: t.arr(t.obj({ key: t.str(), title: t.str(), group: t.enm('space', 'everywhere'), rows: t.int({ minimum: 0 }) })) }, tool: 'meta',
    }),
    read('settings.list', 'Rows of one page (or all) with the value that applies to me', { ...V, in: { page: t.opt(t.str()), scope: t.opt(scope) }, out: { rows: t.arr(settingRow) }, tool: 'meta' }),
    read('settings.get', 'One setting with its value, default and floor', { ...V, in: { key }, out: { row: settingRow }, tool: 'meta' }),
    write('settings.set', 'Change one of my settings; saves as made and returns the previous value so Undo is one call', {
      ...V, in: { key, value: t.json() }, out: { row: settingRow, previous: t.json() }, emits: ['settings.changed'], tool: 'meta', offline: 'queue', errors: ['validation.field_locked'],
    }),
    write('settings.reset', 'Put one of my settings back to the Space default', { ...V, in: { key }, out: { row: settingRow }, emits: ['settings.changed'], tool: 'meta', offline: 'queue' }),
    write('settings.set_space', 'Change a Space-wide setting (the permission of the row decides who may; policy.manage by default)', {
      ...V, in: { key, value: t.json() }, out: { row: settingRow, previous: t.json() }, perm: 'policy.manage', emits: ['settings.changed'], audit: 'always', tool: 'engineer', errors: ['validation.field_locked'],
    }),
    write('settings.reset_space', 'Put a Space-wide setting back to its shipped default', { ...V, in: { key }, out: { row: settingRow }, perm: 'policy.manage', emits: ['settings.changed'], audit: 'always', tool: 'engineer' }),
    read('settings.search', 'Find settings rows by words (Cmd-F)', { ...V, in: { q: t.str() }, out: { rows: t.arr(t.obj({ key: t.str(), page: t.str(), title: t.str(), score: t.num() })) }, tool: 'meta' }),
    write('settings.floor_set', 'Owner floor: set the least strict value anyone in the Space may choose for a floorable setting', {
      ...V, in: { key, floor: t.json() }, out: { row: settingRow }, perm: 'policy.manage', emits: ['settings.floor_changed'], audit: 'always', risk: 'high', tool: 'engineer', team: true,
    }),

    // ---- Copy from another Space
    read('settings.copy_source', 'Profile values of mine that may be copied into another Space: photo, name, handle, time zone and hours, contact (title never)', {
      ...V, in: {}, out: { photoFileId: t.opt(id.file), name: t.opt(t.str()), handle: t.opt(t.str()), timezone: t.opt(t.str()), hours: t.opt(t.json()), contact: t.opt(t.obj({ email: t.opt(t.str()), phone: t.opt(t.str()) })) }, tool: 'meta',
    }),
    write('settings.copy_profile', 'Apply values read from another Space to my profile here; the title is never copied', {
      ...V, in: { fields: t.arr(copyFields), values: t.rec() }, out: { applied: t.arr(copyFields) }, emits: ['settings.changed'], tool: 'meta', offline: 'queue', errors: ['validation.bad_input'],
    }),

    // ---- Kit choice (chosen per Space or per person)
    read('settings.kit.get', 'The Kit chosen for this Space, my own choice, and the one in effect', { ...V, in: {}, out: { kit: kitChoice }, tool: 'meta' }),
    write('settings.kit.set_mine', 'Choose my own Kit for this Space (null follows the Space)', { ...V, in: { kitId: t.nullable(id.kit) }, out: { kit: kitChoice }, emits: ['settings.changed'], tool: 'meta', offline: 'queue' }),
    write('settings.kit.set_space', 'Choose the Kit for the whole Space', { ...V, in: { kitId: id.kit }, out: { kit: kitChoice }, perm: 'kits.install', emits: ['settings.changed'], audit: 'always', tool: 'meta', team: true }),
  ],

  screens: [
    screen('settings.page', 'settings', 'ui:SettingsPage', { q: { pages: ['settings.pages'], rows: ['settings.list', { page: '/state/page' }] }, a: { set: ['settings.set', { key: '/state/key', value: '/state/value' }], reset: ['settings.reset', { key: '/state/key' }] }, empty: 'Nothing to set here' }),
    screen('settings.search', 'settings', 'ui:SettingsSearch', { slot: 'popover', q: { hits: ['settings.search', { q: '/state/query' }] }, empty: 'No setting matches' }),
    screen('settings.copy_profile', 'settings', 'ui:CopyFromSpace', { slot: 'sheet', q: { source: ['settings.copy_source'] }, a: { apply: ['settings.copy_profile', { fields: '/state/fields', values: '/state/values' }] } }),
    screen('settings.kit', 'settings', 'ui:KitChoice', { slot: 'sheet', q: { kit: ['settings.kit.get'] }, a: { mine: ['settings.kit.set_mine', { kitId: '/state/kitId' }], space: ['settings.kit.set_space', { kitId: '/state/kitId' }] } }),
  ],

  settings: [
    setting('security.level', 'person', 'This computer', 'Security level', t.enm('relaxed', 'standard', 'strict'), 'standard', { floorable: true }),
    setting('security.terminal_mode', 'person', 'This computer', 'Terminal prompts on this computer (Ask, Allow or Auto; one value per Space)', t.obj({ base: t.enm('ask', 'allow', 'auto'), spaces: t.rec(t.enm('ask', 'allow', 'auto')) }), { base: 'ask', spaces: {} }, { floorable: true }),
    setting('security.chrome_mode', 'person', 'This computer', 'Chrome prompts on this computer (Ask, Allow or Auto; one value per Space)', t.obj({ base: t.enm('ask', 'allow', 'auto'), spaces: t.rec(t.enm('ask', 'allow', 'auto')) }), { base: 'ask', spaces: {} }, { floorable: true }),
    setting('security.team_agents_on_my_computer', 'person', 'This computer', 'Let team agents use my terminal (per Space, locked to a work folder)', t.rec(t.bool()), {}),
    setting('chrome.agents_use_my_browser', 'person', 'This computer', 'Let agents use my Chrome (per Space, only that Space agents, with a visible indicator)', t.rec(t.bool()), {}),
    setting('profile.display_name', 'person', 'profile', 'Name', t.str(), ''),
    setting('profile.handle', 'person', 'profile', 'Handle', t.str({ pattern: '^([a-z0-9_.-]{2,32})?$' }), ''),
    setting('profile.title', 'person', 'profile', 'Title', t.str(), ''),
    setting('profile.photo', 'person', 'profile', 'Photo', t.nullable(id.file), null),
    setting('profile.timezone', 'person', 'profile', 'Time zone', t.str({ examples: ['Asia/Karachi'] }), 'UTC'),
    setting('profile.working_hours', 'person', 'profile', 'Working hours', t.obj({ days: t.arr(t.int({ minimum: 0, maximum: 6 })), from: t.str({ pattern: '^[0-2][0-9]:[0-5][0-9]$' }), to: t.str({ pattern: '^[0-2][0-9]:[0-5][0-9]$' }) }), { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' }),
    setting('profile.contact', 'person', 'profile', 'Contact', t.obj({ email: t.opt(t.str()), phone: t.opt(t.str()) }), {}),
    setting('appearance.skin', 'person', 'appearance', 'Skin', t.str(), 'classic'),
    setting('appearance.mode', 'person', 'appearance', 'Light or dark', t.enm('system', 'light', 'dark'), 'system'),
    setting('appearance.density', 'person', 'appearance', 'Density', t.enm('comfortable', 'compact'), 'comfortable'),
    setting('appearance.text_size', 'person', 'appearance', 'Text size (percent)', t.int({ minimum: 90, maximum: 120 }), 100),
    setting('appearance.reduce_motion', 'person', 'appearance', 'Reduce motion', t.bool(), false),
    setting('keyboard.overrides', 'person', 'keyboard', 'Shortcuts', t.rec(t.str()), {}),
    setting('kit.person_choice', 'person', 'appearance', 'My Kit', t.nullable(id.kit), null),
    setting('kit.space_choice', 'space', 'spaces', 'Space Kit', t.nullable(id.kit), null),
  ],
});
