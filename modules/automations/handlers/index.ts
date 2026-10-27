// One handler per automations capability. Definitions, versions, Groups, alerts, followers, webhook and Promote live in defs.ts; Runs and triggers in triggers.ts.
import {
  alertsGet, alertsSet, create, followersAdd, followersRemove, get, groupsCreate, groupsDelete, groupsList, groupsRename, list, makePersonalCopy, move, previewPromote, promote, remove,
  restoreVersion, setEnabled, stepsList, triggersList, undelete, update, validate, versions, webhookGet, webhookRotate,
} from "./defs.ts";
import { scheduleChoose } from "./schedule.ts";
import { fire, replay, retry, run, stop, test } from "./triggers.ts";

export const handlers = {
  "automations.alerts.get": alertsGet,
  "automations.alerts.set": alertsSet,
  "automations.create": create,
  "automations.delete": remove,
  "automations.fire": fire,
  "automations.followers.add": followersAdd,
  "automations.followers.remove": followersRemove,
  "automations.get": get,
  "automations.groups.create": groupsCreate,
  "automations.groups.delete": groupsDelete,
  "automations.groups.list": groupsList,
  "automations.groups.rename": groupsRename,
  "automations.list": list,
  "automations.make_personal_copy": makePersonalCopy,
  "automations.move": move,
  "automations.preview_promote": previewPromote,
  "automations.promote": promote,
  "automations.replay": replay,
  "automations.restore_version": restoreVersion,
  "automations.retry": retry,
  "automations.run": run,
  "automations.schedule_choose": scheduleChoose,
  "automations.set_enabled": setEnabled,
  "automations.steps.list": stepsList,
  "automations.stop": stop,
  "automations.test": test,
  "automations.triggers.list": triggersList,
  "automations.undelete": undelete,
  "automations.update": update,
  "automations.validate": validate,
  "automations.versions": versions,
  "automations.webhook_url.get": webhookGet,
  "automations.webhook_url.rotate": webhookRotate,
};
