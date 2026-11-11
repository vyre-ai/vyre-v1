// One handler per access capability. Share and folders are handlers/share.ts (P-L7_02); requests, reviews and proposals are request.ts, review.ts and propose.ts.
import { builderGrant, builderStatus } from "./connector-builder.ts";
import {
  foldersCreate, foldersDelete, foldersList, foldersMove, foldersPlace, foldersRename, foldersUnplace, automationSenders, deciders, joinShare, lists, share, sharesOf, unshare, audienceSet, makeOwner, agentsCanCallGet, agentsCanCallSet, recordMarks,
} from "./share.ts";
import {
  actorsCreate, actorsEngineer, actorsList, actorsRedeem, actorsRevoke, actorsUpdate, check, providerCheck,
  labelsList, labelsSet, policiesList, policiesReset, policiesSet, projectionHealth, viewAs,
} from "./check.ts";
import {
  defaultsGet, defaultsSet, grantsList, grantsUpdate, groupsAddMember, groupsCreate, groupsDelete,
  groupsGet, groupsList, groupsRemoveMember, groupsUpdate, principalsEffective, principalsGet,
  principalsList, rolesApply, rolesAssign, rolesCreate, rolesDelete, rolesGet, rolesList,
  rolesPreview, rolesUnassign, rolesUpdate,
} from "./roles.ts";
import { proposeChange } from "./propose.ts";
import { reachBatch } from "./reach.ts";
import { exceptionsExplain, exceptionsLapse, exceptionsList, exceptionsRemove, exceptionsSet } from "./exceptions.ts";
import { requestCreate, requestsApprove, requestsDecline, requestsList } from "./request.ts";
import { reviewsClose, reviewsDecide, reviewsGet, reviewsList, reviewsStart } from "./review.ts";
import { readOnly } from "../projections.ts";

// readOnly: capabilities that only read the access store, asked per message, per turn or per item in a list. They read the kept view of access.sync (projections.ts) instead of every
// access table; the view refuses any change, so one of these that ever tried to write would fail loudly (tests/read-view.test.ts runs each one on it). access.lists and folders.list are
// not here: they rebuild and write the my_access cache.

export const handlers = {
  "access.actors.create": actorsCreate,
  "access.actors.list": actorsList,
  "access.actors.redeem": actorsRedeem,
  "access.actors.revoke": actorsRevoke,
  "access.actors.set_engineer_mcp": actorsEngineer,
  "access.actors.update": actorsUpdate,
  "access.check": readOnly(check),
  "access.provider_check": readOnly(providerCheck),
  "access.grants.list": readOnly(grantsList),
  "access.grants.update": grantsUpdate,
  "access.groups.add_member": groupsAddMember,
  "access.groups.create": groupsCreate,
  "access.groups.defaults_get": defaultsGet,
  "access.groups.defaults_set": defaultsSet,
  "access.exceptions.list": exceptionsList,
  "access.exceptions.set": exceptionsSet,
  "access.exceptions.remove": exceptionsRemove,
  "access.exceptions.lapse": exceptionsLapse,
  "access.exceptions.explain": exceptionsExplain,
  "access.groups.delete": groupsDelete,
  "access.groups.get": readOnly(groupsGet),
  "access.groups.list": readOnly(groupsList),
  "access.groups.remove_member": groupsRemoveMember,
  "access.groups.update": groupsUpdate,
  "access.labels.list": labelsList,
  "access.labels.set": labelsSet,
  "access.lists": lists,
  "access.policies.list": policiesList,
  "access.policies.reset": policiesReset,
  "access.policies.set": policiesSet,
  "access.principals.effective": readOnly(principalsEffective),
  "access.principals.get": readOnly(principalsGet),
  "access.principals.list": readOnly(principalsList),
  "access.projection_health": projectionHealth,
  "access.propose_change": proposeChange,
  "access.reach": readOnly(reachBatch),
  "access.request": requestCreate,
  "access.requests.approve": requestsApprove,
  "access.requests.decline": requestsDecline,
  "access.requests.list": requestsList,
  "access.reviews.close": reviewsClose,
  "access.reviews.decide": reviewsDecide,
  "access.reviews.get": reviewsGet,
  "access.reviews.list": reviewsList,
  "access.reviews.start": reviewsStart,
  "access.connector_builder.grant": builderGrant,
  "access.connector_builder.status": builderStatus,
  "access.roles.apply": rolesApply,
  "access.roles.assign": rolesAssign,
  "access.roles.create": rolesCreate,
  "access.roles.delete": rolesDelete,
  "access.roles.get": readOnly(rolesGet),
  "access.roles.list": readOnly(rolesList),
  "access.roles.preview": rolesPreview,
  "access.roles.unassign": rolesUnassign,
  "access.roles.update": rolesUpdate,
  "access.automation_senders": automationSenders,
  "access.share": share,
  "access.join_share": joinShare,
  "access.shares_of": readOnly(sharesOf),
  "access.audience_set": audienceSet,
  "access.make_owner": makeOwner,
  "access.agents_can_call.set": agentsCanCallSet,
  "access.agents_can_call.get": readOnly(agentsCanCallGet),
  "access.record_marks": readOnly(recordMarks),
  "access.deciders": readOnly(deciders),
  "access.unshare": unshare,
  "access.view_as": viewAs,
  "folders.create": foldersCreate,
  "folders.delete": foldersDelete,
  "folders.list": foldersList,
  "folders.move": foldersMove,
  "folders.place": foldersPlace,
  "folders.rename": foldersRename,
  "folders.unplace": foldersUnplace,
};
