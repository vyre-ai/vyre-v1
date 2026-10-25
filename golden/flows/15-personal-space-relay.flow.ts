// Golden flow 15: Personal Space via the relay. Steps live in golden/steps/15-personal-space-relay.ts (L11).
//
// The trace, in order (ARCH 5.13, spec 2.1; the same shape is exercised in modules/sync/tests/personal.relay.test.ts):
//   1  the person's desktop is the host of their Personal Space (a `--role space` daemon, space.kind personal)
//   2  the person pairs the phone: it registers as a device through the relay              device.registered
//   3  the phone takes its snapshot and its first pulls                                      sync.completed
//   4  an edit on the phone goes through the live socket while the host is on                sync.pushed
//   5  the desktop goes off: the relay answers unavailable, the phone reads its replica and says "Your computer is off"
//   6  the person edits on the phone: the replica shows it, the outbox holds it ("1 change waiting"); the push is turned away   sync.push_failed
//   7  the Space reports its host gone                                                       health.changed
//   8  a team-only capability asked of the Personal Space is refused with permission.needs_team ("Needs a Team Space")
//   9  a chat on the phone waits: "Your computer is off, turn it on to continue"
//  10  the desktop comes back; the relay passes calls through again
//  11  the queued edit is pushed with the same op id and is applied once                     sync.pushed
//  12  the phone pulls what it missed and its replica equals the host's                       sync.completed
//  13  the person revokes the phone from the desktop: the device's epoch rises                 sync.epoch_bumped, device.revoked
//  14  on its next contact the phone's pull answers purge; the replica, keys and local folder are wiped   device.purged
//  15  the person's other devices are untouched; the phone can pair again as a new device
// The events below are the ones those steps must produce, in this order, all on one trace id.
import { defineFlow } from "../harness/index.ts";

export default defineFlow({
  n: 15,
  name: "personal-space-relay",
  title: "Personal Space via the relay",
  needs: ["spaces", "sync", "devices", "network", "health"],
  events: [
    "device.registered", "sync.completed", "sync.pushed", "sync.push_failed", "health.changed", "sync.pushed", "sync.completed",
    "sync.epoch_bumped", "device.revoked", "device.purged",
  ],
});
