// devices (lane L7a): sessions, devices and epochs (5.7). A revoked device or a lower epoch gets the purge path in sync.
// DECISION: device and session ids are issued by the same sign-in call that opens the session; devices.register is the system half.
// DECISION: capabilities with owner-or-admin rules (revoke, rename) bind the Space at level view and the handler checks "own device, or access.manage".
import { defineManifest, entity, ev, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { id, ok, pageIn, pageOut, principalRef } from './_common.ts';

const V = { level: 'view' } as const;
const klass = t.enm('desktop', 'phone', 'web', 'extension', 'daemon');
const deviceRow = t.obj({
  id: id.device, person: id.user, name: t.str(), class: klass, epoch: t.int({ minimum: 0 }),
  lastSeenAt: t.opt(t.ts()), location: t.opt(t.str()), revokedAt: t.opt(t.ts()), current: t.opt(t.bool()),
});
const sessionRow = t.obj({
  id: id.session, principal: principalRef, deviceId: t.opt(id.device), kind: t.enm('device', 'agent_run'),
  startedAt: t.ts(), lastSeenAt: t.ts(), location: t.opt(t.str()), current: t.opt(t.bool()),
});
const epochReason = t.enm('device_revoked', 'suspended', 'removed', 'password_reset', 'clearance_lowered', 'key_rotation');

export default defineManifest({
  id: 'devices',
  title: 'Devices',
  owner: 'L7a',

  events: [
    ev('device.registered', 'A device signed in for the first time', { p: { deviceId: id.device, person: id.user, class: klass, name: t.str() }, subject: ['entity', '/deviceId'], vis: 'owner' }),
    ev('device.revoked', 'A device was revoked; it purges its replica on next contact', { p: { deviceId: id.device, person: id.user, by: t.str() }, subject: ['entity', '/deviceId'], retention: 'audit' }),
    ev('device.purged', 'A device confirmed it wiped its replica', { p: { deviceId: id.device, person: id.user }, subject: ['entity', '/deviceId'], vis: 'owner' }),
    ev('session.started', 'A session opened on a device', { p: { sessionId: id.session, person: id.user, deviceId: id.device }, subject: ['entity', '/sessionId'], vis: 'owner' }),
    ev('session.revoked', 'A session was ended by the person or an admin', { p: { sessionId: id.session, person: id.user, by: t.str() }, subject: ['entity', '/sessionId'], retention: 'audit' }),
    ev('epoch.bumped', 'A person epoch or the Space key epoch advanced; lower epochs purge', { p: { scope: t.enm('person', 'space'), person: t.opt(id.user), epoch: t.int({ minimum: 0 }), reason: epochReason }, subject: ['entity', '/epoch'], retention: 'audit' }),
  ],

  capabilities: [
    read('devices.mine', 'My devices and sessions in this Space (Settings > Sign-in and devices)', { ...V, in: {}, out: { devices: t.arr(deviceRow), sessions: t.arr(sessionRow) }, tool: 'meta' }),
    read('devices.list', 'All devices in the Space, by person or class (Console > Sessions and devices)', { ...V, in: { person: t.opt(id.user), class: t.opt(klass), ...pageIn }, out: { devices: t.arr(deviceRow), ...pageOut }, perm: 'access.manage', tool: 'meta', team: true }),
    read('devices.get', 'One device with its sessions', { ...V, in: { deviceId: id.device }, out: { device: deviceRow, sessions: t.arr(sessionRow) }, tool: 'meta' }),
    write('devices.rename', 'Rename one of my devices', { ...V, in: { deviceId: id.device, name: t.str() }, out: { device: deviceRow }, tool: 'meta' }),
    write('devices.revoke', 'Revoke a device: its sessions end and its replica is purged on next contact', { ...V, in: { deviceId: id.device }, out: ok, emits: ['device.revoked', 'session.revoked', 'epoch.bumped'], audit: 'always', offline: 'online', tool: 'meta' }),
    write('devices.revoke_others', 'Sign out everywhere except this device', { ...V, in: {}, out: { revoked: t.int({ minimum: 0 }) }, emits: ['device.revoked', 'session.revoked', 'epoch.bumped'], audit: 'always', offline: 'online', tool: 'meta' }),
    read('devices.sessions.list', 'Sessions of a person (own, or any with access.manage)', { ...V, in: { person: t.opt(id.user), ...pageIn }, out: { sessions: t.arr(sessionRow), ...pageOut }, tool: 'meta' }),
    write('devices.sessions.revoke', 'End one session', { ...V, in: { sessionId: id.session }, out: ok, emits: ['session.revoked'], audit: 'always', offline: 'online', tool: 'meta' }),
    write('devices.rotate_space_key', 'Rotate the Space data key epoch (wrapped anew for each remaining member; old data re-encrypted in the background)', {
      ...V, idem: 'key', in: { reason: t.opt(t.str()) }, out: { epoch: t.int({ minimum: 0 }) }, perm: 'access.manage', emits: ['epoch.bumped'], audit: 'always', risk: 'high', tool: 'engineer', team: true,
    }),

    // system halves, called by identity, members and sync
    write('devices.register', 'Host only (svc_host): create the device and session rows at sign-in; every person, admin, agent and other service is refused', { ...V, idem: 'key', in: { person: id.user, name: t.str(), class: klass }, out: { device: deviceRow, sessionId: id.session }, emits: ['device.registered', 'session.started'] }),
    write('devices.touch', 'System: update last seen and location of a device', { ...V, in: { deviceId: id.device, location: t.opt(t.str()) }, out: ok, offline: 'online' }),
    read('devices.epoch', 'System: the person epoch and Space key epoch a client compares in hello', { ...V, in: {}, out: { personEpoch: t.int({ minimum: 0 }), spaceEpoch: t.int({ minimum: 0 }), revoked: t.bool() } }),
    write('devices.epoch_bump', 'System: advance a person epoch (device revoked, suspended, removed, password reset, clearance lowered)', { ...V, in: { person: id.user, reason: epochReason }, out: { epoch: t.int({ minimum: 0 }) }, emits: ['epoch.bumped'], audit: 'always' }),
    write('devices.purge_ack', 'System: a device reports that its replica, keychain entries and caches are gone', { ...V, in: { deviceId: id.device }, out: ok, emits: ['device.purged'], offline: 'online' }),
  ],

  entities: [
    entity('device', 'devices_device', 'dev_', { person: 'person', name: 'text', class: 'choice', epoch: 'number', lastSeenAt: 'datetime', location: 'text', revokedAt: 'datetime' }, 'space', { ownerField: 'person', sync: { profile: { desktop: 'all', phone: 'all', web: 'all' } } }),
  ],

  screens: [
    screen('devices.mine', 'settings', 'ui:SettingsSignInDevices', { q: { mine: ['devices.mine'] }, a: { revoke: ['devices.revoke', { deviceId: '/state/deviceId' }, 'Sign this device out and wipe its copy?'], revoke_others: ['devices.revoke_others', {}, 'Sign out everywhere else?'], rename: ['devices.rename', { deviceId: '/state/deviceId', name: '/state/name' }] }, empty: 'This is your only device' }),
    screen('devices.sessions', 'console', 'ui:ConsoleSessions', { needs: ['access.manage'], q: { devices: ['devices.list', { person: '/state/person', class: '/state/class' }] }, a: { revoke: ['devices.revoke', { deviceId: '/state/deviceId' }, 'Revoke this device?'], end: ['devices.sessions.revoke', { sessionId: '/state/sessionId' }] }, empty: 'No devices match' }),
  ],
});
