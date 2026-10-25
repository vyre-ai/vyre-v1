// One handler per members capability (17). Invites and the join are invite.ts, suspend and the removal wizard remove.ts, sign-in policy, second factor and SSO policy.ts.
import { accept, invitesCreate, invitesExtend, invitesList, invitesPreview, invitesRevoke } from "./invite.ts";
import { policyGetH, policySet, secondFactorReport, ssoList, ssoRemove, ssoSet, ssoTest } from "./policy.ts";
import { reactivate, remove, removePreview, suspend } from "./remove.ts";

export const handlers = {
  "members.accept": accept,
  "members.invites.create": invitesCreate,
  "members.invites.extend": invitesExtend,
  "members.invites.list": invitesList,
  "members.invites.preview": invitesPreview,
  "members.invites.revoke": invitesRevoke,
  "members.reactivate": reactivate,
  "members.remove": remove,
  "members.remove_preview": removePreview,
  "members.second_factor.report": secondFactorReport,
  "members.sign_in_policy.get": policyGetH,
  "members.sign_in_policy.set": policySet,
  "members.sso.list": ssoList,
  "members.sso.remove": ssoRemove,
  "members.sso.set": ssoSet,
  "members.sso.test": ssoTest,
  "members.suspend": suspend,
};
