# Members (members)

Lane L7a. Kind module. Version 0.1.0.

Requires: access, home.

## Capabilities (31)

- [company.access_log](../capabilities/company.access_log.md): Who reached whose mail, calendar or files: who made the call, the person an agent worked for, which mailbox, when
- [company.check](../capabilities/company.check.md): Prove the key now in the Vault works, with no person involved. Answers what is wrong in plain words, or who it is; never the key. A key that works is remembered
- [company.connect](../capabilities/company.connect.md): The one confirmation: everyone included comes in, and the directory is watched from here on
- [company.disconnect](../capabilities/company.disconnect.md): Undo: every member sync stops at once; what already came in stays with its owner
- [company.guide](../capabilities/company.guide.md): The guide for a step of Connect your company, or all of it: the doc page itself
- [company.people_done](../capabilities/company.people_done.md): A person has looked at who is in; the flow moves on to the one confirmation
- [company.probe](../capabilities/company.probe.md): The read-only check of what the company allowed, as one line a person can act on
- [company.script](../capabilities/company.script.md): The one paste that does the provider's side: which shell to open and the script. It holds no secret; the admin runs it under their own account
- [company.start](../capabilities/company.start.md): Start Connect your company for Google Workspace or Microsoft 365 and choose Mail, Calendar and Files, or pick it up where it stands
- [company.status](../capabilities/company.status.md): Where Connect your company stands: the provider, each step and whether it is done, the next step, and which doc section explains it. Read this first; it never asks twice
- [company.sweep](../capabilities/company.sweep.md): Check the directory: a person gone from it stops and loses access. Runs on a schedule; a person confirms a change large enough to be held
- [members.accept](../capabilities/members.accept.md): Accept an invite: pick a username and password, the device makes its keys; the person becomes active
- [members.invites.create](../capabilities/members.invites.create.md): Invite a person: role, groups, the agents, projects and channels they start in, expiry; returns the link (address, one-time code, Space key fingerprint)
- [members.invites.extend](../capabilities/members.invites.extend.md): Give an open invite a new expiry
- [members.invites.list](../capabilities/members.invites.list.md): List invites
- [members.invites.preview](../capabilities/members.invites.preview.md): Join page: the public Space routing id, name and logo, who invited, expiry and display fingerprint for a code
- [members.invites.revoke](../capabilities/members.invites.revoke.md): Revoke an open invite
- [members.reactivate](../capabilities/members.reactivate.md): Reactivate a suspended person
- [members.remove](../capabilities/members.remove.md): Remove a person with the wizard plan: reassign owned things, pause routines, revoke mailbox connections, rotate the Space key epoch
- [members.remove_preview](../capabilities/members.remove_preview.md): Removal wizard: each kind of thing the person owns, its default action and the transfer diff
- [members.second_factor.report](../capabilities/members.second_factor.report.md): Who has a second factor and who does not (when the floor is on, the ones locked out soon)
- [members.sign_in_github.clear](../capabilities/members.sign_in_github.clear.md): Forget the GitHub sign-in app set in the app (a server environment setting stays)
- [members.sign_in_github.get](../capabilities/members.sign_in_github.get.md): The GitHub sign-in app: the client id, whether the secret is set (never the secret), where it comes from, and the callback address to register at GitHub
- [members.sign_in_github.set](../capabilities/members.sign_in_github.set.md): Turn on GitHub sign-in: the OAuth app client id and secret; the secret goes into the Vault as a Space item and is never shown again
- [members.sign_in_policy.get](../capabilities/members.sign_in_policy.get.md): The Space sign-in policy: second-factor floor, SSO required, allowed methods
- [members.sign_in_policy.set](../capabilities/members.sign_in_policy.set.md): Set the sign-in policy (owner floor: nobody goes below it)
- [members.sso.list](../capabilities/members.sso.list.md): List SSO providers set for this Space
- [members.sso.remove](../capabilities/members.sso.remove.md): Remove an SSO provider
- [members.sso.set](../capabilities/members.sso.set.md): Add or change an OIDC provider (Google, Microsoft, Okta); the client secret is a Vault item named by handle
- [members.sso.test](../capabilities/members.sso.test.md): Test an SSO provider: discovery document, keys and redirect
- [members.suspend](../capabilities/members.suspend.md): Suspend a person: they cannot act and their devices purge on next contact

## Events (5)

- [member.invite_revoked](../events/member.invite_revoked.md): An invite was revoked
- [member.invited](../events/member.invited.md): An invite was made
- [member.joined](../events/member.joined.md): A person accepted an invite and is active; the inviter gets a quiet line
- [member.removal_plan_applied](../events/member.removal_plan_applied.md): The removal wizard reassigned or paused the things the person owned (counts only)
- [member.removed](../events/member.removed.md): A person was removed or left; devices purge, the Space key epoch rotates
