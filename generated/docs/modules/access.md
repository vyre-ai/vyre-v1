# Access (access)

Lane L7a. Kind module. Version 0.1.0.

Requires: files.

## Capabilities (58)

- [access.actors.create](../capabilities/access.actors.create.md): Register an outside actor and issue a one-time token (works once, within 10 minutes)
- [access.actors.list](../capabilities/access.actors.list.md): List outside actors (registered external tools such as Claude Code or Codex)
- [access.actors.redeem](../capabilities/access.actors.redeem.md): The outside tool trades its one-time token for a registered credential; the actor turns active
- [access.actors.revoke](../capabilities/access.actors.revoke.md): Revoke the token of an outside actor in one click
- [access.actors.set_engineer_mcp](../capabilities/access.actors.set_engineer_mcp.md): Allow or stop an outside actor using the Engineer MCP toolset
- [access.actors.update](../capabilities/access.actors.update.md): Change the roles or declared provider of an outside actor
- [access.check](../capabilities/access.check.md): Access checker: can principal P do action A on resource R, with each step in plain words
- [access.grants.list](../capabilities/access.grants.list.md): List grants by resource, subject or source (Console Grants)
- [access.grants.update](../capabilities/access.grants.update.md): Change the level, conditions or expiry of a grant
- [access.groups.add_member](../capabilities/access.groups.add_member.md): Add a person or agent to a group (groups hold no groups)
- [access.groups.create](../capabilities/access.groups.create.md): Create a group of people and agents
- [access.groups.defaults_get](../capabilities/access.groups.defaults_get.md): Default grants of the built-in Everyone group (every member holds them; Kits ship the first set and invites add new people to the group)
- [access.groups.defaults_set](../capabilities/access.groups.defaults_set.md): Replace the default grants of the Everyone group; the sheet shows who gains what, then applies
- [access.groups.delete](../capabilities/access.groups.delete.md): Delete a group; grants given to it go with it
- [access.groups.get](../capabilities/access.groups.get.md): Read one group with members, managers, roles and grants given to it
- [access.groups.list](../capabilities/access.groups.list.md): List groups
- [access.groups.remove_member](../capabilities/access.groups.remove_member.md): Remove a person or agent from a group
- [access.groups.update](../capabilities/access.groups.update.md): Rename a group or change its managers
- [access.labels.list](../capabilities/access.labels.list.md): The four sensitivity labels with rank, provider rule and laptop-sync rule
- [access.labels.set](../capabilities/access.labels.set.md): Set the sensitivity label of a folder, channel, inbox or other container (items inherit unless set)
- [access.lists](../capabilities/access.lists.md): Items of one type in a section (Personal, Shared with me, Space, Starred, Following) with folder counts
- [access.policies.list](../capabilities/access.policies.list.md): List Space policies (Gate rules, spend, label rules, sign-in, sharing, retention, vault)
- [access.policies.reset](../capabilities/access.policies.reset.md): Reset a policy to its default
- [access.policies.set](../capabilities/access.policies.set.md): Set a policy value; applies last in the decision
- [access.principals.effective](../capabilities/access.principals.effective.md): Effective permissions, grants held and things owned for one principal (computed)
- [access.principals.get](../capabilities/access.principals.get.md): Read one principal
- [access.principals.list](../capabilities/access.principals.list.md): List principals (people, agents, outside actors, services) with roles and groups
- [access.projection_health](../capabilities/access.projection_health.md): Health probe: access projections are current and the epoch is advancing
- [access.propose_change](../capabilities/access.propose_change.md): View-level Ask: store a drafted change for the editors of an object as a changeset or Review task; writes nothing to the object
- [access.request](../capabilities/access.request.md): Ask the Manage holders of a resource (or the admins, for a permission) for access; one open request per person and resource
- [access.requests.approve](../capabilities/access.requests.approve.md): Approve an access request: shares as the approver and tells the requester
- [access.requests.decline](../capabilities/access.requests.decline.md): Decline an access request with a note for the requester
- [access.requests.list](../capabilities/access.requests.list.md): Access requests I made, or waiting on me to decide
- [access.reviews.close](../capabilities/access.reviews.close.md): Close a review
- [access.reviews.decide](../capabilities/access.reviews.decide.md): Keep a grant or remove it in one click
- [access.reviews.get](../capabilities/access.reviews.get.md): Items of one review: who holds what, last used, decision so far
- [access.reviews.list](../capabilities/access.reviews.list.md): List access reviews
- [access.reviews.start](../capabilities/access.reviews.start.md): Open an access review now (the quarterly job calls this too)
- [access.roles.apply](../capabilities/access.roles.apply.md): Apply a staged role permission change (the diff from preview)
- [access.roles.assign](../capabilities/access.roles.assign.md): Give a role to a person, group or agent (agents never get Owner or Admin)
- [access.roles.create](../capabilities/access.roles.create.md): Create a custom role, usually by cloning a built-in one
- [access.roles.delete](../capabilities/access.roles.delete.md): Delete a custom role; blocked while anyone holds it
- [access.roles.get](../capabilities/access.roles.get.md): Read one role with holders and where it is granted
- [access.roles.list](../capabilities/access.roles.list.md): List roles with their permissions, clearance and holder counts
- [access.roles.preview](../capabilities/access.roles.preview.md): Stage a change to the permissions of a role as a diff: who gains and who loses what
- [access.roles.unassign](../capabilities/access.roles.unassign.md): Take a role away from a person, group or agent
- [access.roles.update](../capabilities/access.roles.update.md): Rename a custom role or change its clearance; built-in roles are locked
- [access.share](../capabilities/access.share.md): Give a person, group, role, agent or automation a level on a resource (flows down; folders cover their items)
- [access.shares_of](../capabilities/access.shares_of.md): Who has access to a resource, through what (direct, group, role, folder), with conditions and expiry
- [access.unshare](../capabilities/access.unshare.md): Remove a grant, or every grant of one source on a resource
- [access.view_as](../capabilities/access.view_as.md): Preview what a member sees: a read-only preview session for 10 minutes (audited)
- [folders.create](../capabilities/folders.create.md): Make a folder for one type of thing (Personal, or Space when the person may share)
- [folders.delete](../capabilities/folders.delete.md): Delete a folder; its items go back to their owners
- [folders.list](../capabilities/folders.list.md): Folders of one type with item counts, as a tree
- [folders.move](../capabilities/folders.move.md): Move a folder under another folder, or to the top
- [folders.place](../capabilities/folders.place.md): Put an item in a folder; a shared folder shares it, nothing is copied
- [folders.rename](../capabilities/folders.rename.md): Rename a folder
- [folders.unplace](../capabilities/folders.unplace.md): Take an item out of its folder back to the top of its section

## Events (18)

- [access.changed](../events/access.changed.md): Roles, groups, labels or membership changed; bumps the authorize cache epoch
- [access.declined](../events/access.declined.md): An access request was declined; the note goes back to the requester
- [access.everyone_defaults_changed](../events/access.everyone_defaults_changed.md): The default grants of the Everyone group changed
- [access.granted](../events/access.granted.md): An access request was approved
- [access.requested](../events/access.requested.md): Someone asked for access to a resource
- [access_review.closed](../events/access_review.closed.md): An access review closed
- [access_review.opened](../events/access_review.opened.md): A quarterly access review opened and made its tasks
- [folder.shared](../events/folder.shared.md): A folder was shared or unshared; everything in it follows
- [grant.created](../events/grant.created.md): A grant was given to a person, group, role or link
- [grant.revoked](../events/grant.revoked.md): A grant was removed
- [grant.updated](../events/grant.updated.md): The level, conditions or expiry of a grant changed
- [item.moved](../events/item.moved.md): An item moved into or out of a folder
- [policy.changed](../events/policy.changed.md): A Space policy was set or reset (Gate rule, spend, label rule, sign-in, sharing, retention, vault)
- [principal.created](../events/principal.created.md): A person, agent, outside actor or service came to exist
- [principal.reactivated](../events/principal.reactivated.md): A suspended principal was reactivated
- [principal.suspended](../events/principal.suspended.md): A principal was suspended
- [token.revoked](../events/token.revoked.md): An outside actor token was revoked
- [view_as.started](../events/view_as.started.md): An admin previewed what another person sees (audited)
