// One handler per members capability (29). Invites and the join are invite.ts, suspend and the removal wizard remove.ts, sign-in policy, second factor and SSO policy.ts.
import { accept, invitesCreate, invitesGuest, invitesExtend, invitesList, invitesPreview, invitesRevoke, joinsList, joinsRetry } from "./invite.ts";
import { joinLinkCreate, joinLinkDisable, joinLinkGet, joinLinkPreview, joinLinkRequest, joinLinkRotate, joinRequestsApprove, joinRequestsDecline, joinRequestsList } from "./join-link.ts";
import { githubClear, githubGet, githubSet } from "./github.ts";
import { policyGetH, policySet, secondFactorReport, ssoList, ssoRemove, ssoSet, ssoTest } from "./policy.ts";
import { companyHandlers } from "./company.ts";
import { reactivate, remove, removePreview, suspend } from "./remove.ts";

export const handlers = {
  "members.accept": accept,
  "members.invites.create": invitesCreate,
  "members.invites.guest": invitesGuest,
  "members.invites.extend": invitesExtend,
  "members.invites.list": invitesList,
  "members.invites.preview": invitesPreview,
  "members.invites.revoke": invitesRevoke,
  "members.join_link.create": joinLinkCreate,
  "members.join_link.disable": joinLinkDisable,
  "members.join_link.get": joinLinkGet,
  "members.join_link.preview": joinLinkPreview,
  "members.join_link.request": joinLinkRequest,
  "members.join_link.rotate": joinLinkRotate,
  "members.join_requests.approve": joinRequestsApprove,
  "members.join_requests.decline": joinRequestsDecline,
  "members.join_requests.list": joinRequestsList,
  "members.joins.list": joinsList,
  "members.joins.retry": joinsRetry,
  "members.reactivate": reactivate,
  "members.remove": remove,
  "members.remove_preview": removePreview,
  "members.second_factor.report": secondFactorReport,
  "members.sign_in_github.clear": githubClear,
  "members.sign_in_github.get": githubGet,
  "members.sign_in_github.set": githubSet,
  "members.sign_in_policy.get": policyGetH,
  "members.sign_in_policy.set": policySet,
  "members.sso.list": ssoList,
  "members.sso.remove": ssoRemove,
  "members.sso.set": ssoSet,
  "members.sso.test": ssoTest,
  "members.suspend": suspend,
  ...companyHandlers,
};
