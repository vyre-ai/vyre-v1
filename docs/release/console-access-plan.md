# Console Access completion

Scope: People, Groups, Roles, Grants, Policies, Access checker, Access reviews, Sessions and devices. This does not mark the critical workflow prototype as full page completion.

Shared framework: console/objects/ObjectList plus ui/ObjectPage. Domain adapters own live capability reads and mutations. Lists need search, checked filter counts, pagination, selection, real bulk/context actions and keyboard behavior. Objects need name/kind/owner/status headers, Overview/Access/Activity plus domain tabs and a real quick-edit sheet. Destructive actions await actual completion and preview their impact; Undo is supplied only when a real inverse exists.

- People: role/group membership, computed permissions, grants, ownership, devices/sessions and audit trail; invite, role changes, reset impact and one-time reset flow, suspend/reactivate, removal wizard.
- Groups: members/managers, direct held roles, grants and Activity; create/rename/delete. Agent membership cannot inherit forbidden roles through a group.
- Roles: source permission matrix grouped by area with risk dots, locked built-ins, staged permission diff and exact preview hash; effective/direct holders, clearance, grants and Activity; clone/rename/delete.
- Grants: resource access including provenance, conditions and expiry; add/edit/revoke sheets and meaningful impact.
- Policies: per-kind values and scope, typed edits, confirmation and Activity.
- Checker: principal and acting-for/resource/action selection, real decision steps and read-only preview with server enforcement.
- Reviews: list/start, grant decisions, close and linked review tasks.
- Sessions: list/filter/pagination, device/session objects, bulk revocation with impact and actual purge proof.

Backend foundations discovered: invoke audit rows only reached logs.db; Group role assignment rejected groups despite the store supporting group holders; View as returned an unregistered token. These must be implemented and tested, not represented as successful UI controls. The permission catalogue must be browser-safe and remain generated from the source catalogue.

Acceptance: booted mutation to audit.list, actor/on-behalf attribution, no credential payloads in audit, injection denial; group-role effective permission/grant and agent restrictions; focused adapters/framework tests; production export and browser acceptance with authentic light/dark screenshots, deep links, object tabs/sheets/context/keyboard behavior, mutation failure and retry. Exact CI release evidence remains required.
