// One handler per notifications capability (20). Sending, lists, settings, mutes, away and delegates live in rules.ts; device tokens and the push payload in push.ts.
import { kindSetLevel } from "./kinds.ts";
import { pushRegister, pushUnregister } from "./push.ts";
import {
  awayClear, awayGet, awaySet, counts, delegateGet, delegateResolve, delegateSet, digestCollect, kindsList, list, markSeen, muteClear, muteList, muteSet, rulesGet, rulesSet, send,
} from "./rules.ts";

export const handlers = {
  "notifications.away.clear": awayClear,
  "notifications.away.get": awayGet,
  "notifications.away.set": awaySet,
  "notifications.counts": counts,
  "notifications.delegate.get": delegateGet,
  "notifications.delegate.resolve": delegateResolve,
  "notifications.delegate.set": delegateSet,
  "notifications.digest.collect": digestCollect,
  "notifications.kind.set_level": kindSetLevel,
  "notifications.kinds.list": kindsList,
  "notifications.list": list,
  "notifications.mark_seen": markSeen,
  "notifications.mute.clear": muteClear,
  "notifications.mute.list": muteList,
  "notifications.mute.set": muteSet,
  "notifications.push.register": pushRegister,
  "notifications.push.unregister": pushUnregister,
  "notifications.rules.get": rulesGet,
  "notifications.rules.set": rulesSet,
  "notifications.send": send,
};
