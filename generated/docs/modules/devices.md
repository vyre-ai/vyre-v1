# Devices (devices)

Lane L7a. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (14)

- [devices.epoch](../capabilities/devices.epoch.md): System: the person epoch and Space key epoch a client compares in hello
- [devices.epoch_bump](../capabilities/devices.epoch_bump.md): System: advance a person epoch (device revoked, suspended, removed, password reset, clearance lowered)
- [devices.get](../capabilities/devices.get.md): One device with its sessions
- [devices.list](../capabilities/devices.list.md): All devices in the Space, by person or class (Console > Sessions and devices)
- [devices.mine](../capabilities/devices.mine.md): My devices and sessions in this Space (Settings > Sign-in and devices)
- [devices.purge_ack](../capabilities/devices.purge_ack.md): System: a device reports that its replica, keychain entries and caches are gone
- [devices.register](../capabilities/devices.register.md): Host only (svc_host): create the device and session rows at sign-in; every person, admin, agent and other service is refused
- [devices.rename](../capabilities/devices.rename.md): Rename one of my devices
- [devices.revoke](../capabilities/devices.revoke.md): Revoke a device: its sessions end and its replica is purged on next contact
- [devices.revoke_others](../capabilities/devices.revoke_others.md): Sign out everywhere except this device
- [devices.rotate_space_key](../capabilities/devices.rotate_space_key.md): Rotate the Space data key epoch (wrapped anew for each remaining member; old data re-encrypted in the background)
- [devices.sessions.list](../capabilities/devices.sessions.list.md): Sessions of a person (own, or any with access.manage)
- [devices.sessions.revoke](../capabilities/devices.sessions.revoke.md): End one session
- [devices.touch](../capabilities/devices.touch.md): System: update last seen and location of a device

## Events (6)

- [device.purged](../events/device.purged.md): A device confirmed it wiped its replica
- [device.registered](../events/device.registered.md): A device signed in for the first time
- [device.revoked](../events/device.revoked.md): A device was revoked; it purges its replica on next contact
- [epoch.bumped](../events/epoch.bumped.md): A person epoch or the Space key epoch advanced; lower epochs purge
- [session.revoked](../events/session.revoked.md): A session was ended by the person or an admin
- [session.started](../events/session.started.md): A session opened on a device
