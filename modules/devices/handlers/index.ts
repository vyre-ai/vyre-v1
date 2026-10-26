// Capability handlers for devices (14). One file holds them all: sessions.ts.
import {
  epoch, epochBump, get, list, mine, purgeAck, rename, revoke, revokeOthers, rotateSpaceKey, sessionsList, sessionsRevoke, touch,
} from "./sessions.ts";
import { register } from "./register.ts";

export type { DevicesCtx } from "../projections.ts";

export const handlers = {
  "devices.epoch": epoch,
  "devices.epoch_bump": epochBump,
  "devices.get": get,
  "devices.list": list,
  "devices.mine": mine,
  "devices.purge_ack": purgeAck,
  "devices.register": register,
  "devices.rename": rename,
  "devices.revoke": revoke,
  "devices.revoke_others": revokeOthers,
  "devices.rotate_space_key": rotateSpaceKey,
  "devices.sessions.list": sessionsList,
  "devices.sessions.revoke": sessionsRevoke,
  "devices.touch": touch,
};
