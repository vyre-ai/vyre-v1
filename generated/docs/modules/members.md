# Members (members)

Lane L7a. Kind module. Status stub. Version 0.1.0.

Requires: access, home.

## Capabilities (17)

- [members.accept](../capabilities/members.accept.md): Accept an invite: pick a username and password, the device makes its keys; the person becomes active
- [members.invites.create](../capabilities/members.invites.create.md): Invite a person: role, groups, the agents, projects and channels they start in, expiry; returns the link (address, one-time code, Space key fingerprint)
- [members.invites.extend](../capabilities/members.invites.extend.md): Give an open invite a new expiry
- [members.invites.list](../capabilities/members.invites.list.md): List invites
- [members.invites.preview](../capabilities/members.invites.preview.md): Join page: the Space name and logo, who invited, expiry and key fingerprint for a code
- [members.invites.revoke](../capabilities/members.invites.revoke.md): Revoke an open invite
- [members.reactivate](../capabilities/members.reactivate.md): Reactivate a suspended person
- [members.remove](../capabilities/members.remove.md): Remove a person with the wizard plan: reassign owned things, pause routines, revoke mailbox connections, rotate the Space key epoch
- [members.remove_preview](../capabilities/members.remove_preview.md): Removal wizard: each kind of thing the person owns, its default action and the transfer diff
- [members.second_factor.report](../capabilities/members.second_factor.report.md): Who has a second factor and who does not (when the floor is on, the ones locked out soon)
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
