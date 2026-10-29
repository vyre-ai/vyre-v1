// One handler per automations capability. Definitions, versions, Groups, alerts, followers, webhook and Promote live in defs.ts; Runs and triggers in triggers.ts. An OpenAPI draft lives in draft-connector.ts.
import {
  alertsGet, alertsSet, create, followersAdd, followersRemove, get, groupsCreate, groupsDelete, groupsList, groupsRename, list, makePersonalCopy, move, previewPromote, promote, remove,
  restoreVersion, setEnabled, stepsList, triggersList, undelete, update, validate, versions, webhookGet, webhookRotate,
} from "./defs.ts";
import { accountPicks } from "./accounts.ts";
import { draftConnector } from "./draft-connector.ts";
import { acceptConnectorOffer, connectorOffers, declineConnectorOffer } from "./connector-offer.ts";
import { httpRead, httpSend } from "./http-step.ts";
import { openDocument } from "./open-document.ts";
import { openMcp } from "./open-mcp.ts";
import { connectorShares, shareConnector } from "./connector-share.ts";
import { tryConnectorRead } from "./try-read.ts";
import { migrateRuns, migrationPreview } from "./migrate.ts";
import { exportPackage, importPackage, packagesList } from "./packages.ts";
import { scheduleChoose } from "./schedule.ts";
import { fire, replay, retry, run, stop, test } from "./triggers.ts";

export const handlers = {
  "automations.account_picks": accountPicks,
  "automations.alerts.get": alertsGet,
  "automations.alerts.set": alertsSet,
  "automations.create": create,
  "automations.delete": remove,
  "automations.draft_connector": draftConnector,
  "automations.http_read": httpRead,
  "automations.http_send": httpSend,
  "automations.open_document": openDocument,
  "automations.connector_offers": connectorOffers,
  "automations.connector_offer.decline": declineConnectorOffer,
  "automations.connector_offer.accept": acceptConnectorOffer,
  "automations.open_mcp": openMcp,
  "automations.try_read": tryConnectorRead,
  "automations.connector_share": shareConnector,
  "automations.connector_shares": connectorShares,
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
  "automations.migrate_runs": migrateRuns,
  "automations.migration_preview": migrationPreview,
  "automations.move": move,
  "automations.packages.export": exportPackage,
  "automations.packages.import": importPackage,
  "automations.packages.list": packagesList,
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
