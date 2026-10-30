// One handler per automations capability. Definitions, versions, Groups, alerts, followers, webhook and Promote live in defs.ts; Runs and triggers in triggers.ts. An OpenAPI draft lives in draft-connector.ts.
import {
  alertsGet, alertsSet, create, followersAdd, followersRemove, get, groupsCreate, groupsDelete, groupsList, groupsRename, list, makePersonalCopy, move, previewPromote, promote, remove,
  restoreVersion, setEnabled, stepsList, triggersList, undelete, update, validate, versions, webhookGet, webhookRotate,
} from "./defs.ts";
import { accountPicks } from "./accounts.ts";
import { draftConnector } from "./draft-connector.ts";
import { acceptConnectorOffer, connectorOffers, declineConnectorOffer } from "./connector-offer.ts";
import { openDocument } from "./open-document.ts";
import { openMcp } from "./open-mcp.ts";
import { readDocs } from "./read-docs.ts";
import { connectorShares, shareConnector } from "./connector-share.ts";
import { connectorGet, connectorHookGet, connectorHookRotate, connectorPublish, connectorRemove, connectorSave, connectorTrustHost, connectorsList } from "./connector-def.ts";
import { connectorInfo, connectorPoll, connectorRead, connectorSend } from "./connector-run.ts";
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
  "automations.open_document": openDocument,
  "automations.connector.get": connectorGet,
  "automations.connector.info": connectorInfo,
  "automations.connector.poll": connectorPoll,
  "automations.connector.publish": connectorPublish,
  "automations.connector.read": connectorRead,
  "automations.connector.remove": connectorRemove,
  "automations.connector.save": connectorSave,
  "automations.connector.send": connectorSend,
  "automations.connector.trust_host": connectorTrustHost,
  "automations.connector.webhook_url.get": connectorHookGet,
  "automations.connector.webhook_url.rotate": connectorHookRotate,
  "automations.connectors.list": connectorsList,
  "automations.connector_offers": connectorOffers,
  "automations.connector_offer.decline": declineConnectorOffer,
  "automations.connector_offer.accept": acceptConnectorOffer,
  "automations.open_mcp": openMcp,
  "automations.read_docs": readDocs,
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
