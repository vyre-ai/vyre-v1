# Restricted labels are not inherited from folders

Found by the member first-hour walk on 3 Nov (test/member-first-hour.live.test.ts, lane l-memberhour). This lane does not fix it.

## What happens

An owner labels a Shared Vault folder Restricted and then adds an item to it from the Vault. Every Member can list that item. The item is not Restricted: the folder's label never reaches it.

Repro from the walk: `access.labels.set` puts `restricted` on folder "Partners", then `vault.item.put` adds an item to it, and a Member's `vault.items.list` returns that item. Members' clearance is `internal` (modules/access/projections.ts, the role clearances near line 112).

Only two flows are safe today, because each one labels the item as well as the folder:
- Console's SSO save: apps/app/src/console/pages/sso-save.ts, `restrict`.
- Connect your company: apps/app/src/console/pages/suite/flow.ts `storeInVault`, plus host/src/daemon/daemon.ts near line 1070.

The Space AI key and vault-requests `companyFolder` also label each item. The Vault place itself never calls `access.labels.set` (apps/app/src/places/vault), so anything an owner adds there to a Restricted folder is open to every Member.

## Where labels are read

- **kernel/src/authorize/index.ts**, `authorize`, near line 183: `let label = res.label;`. The label is the resource's own row, and only field labels can raise it. `chain` (`snap.chain(id)`, kernel/src/authorize/snapshot.ts near line 175) holds the resource and every ancestor. It is walked for grants (line 88) but not for labels. The clearance check is near line 103 (`label > clearance`), and each grant's ceiling check is near line 58.
- **kernel/src/authorize/scope.ts**, `aclIds`, near line 63: list filtering compares `r.label > g.ceiling` with the row's own label in the same way.
- **modules/access/consumers.ts**, near line 124: a resource is born with `labelOf(payload.label) || 0`. A vault item created inside a Restricted folder is therefore born `public`/`internal`.
- The create path is the one exception. When authorize checks a new child (`ref.id === null`, index.ts near line 181), it already uses the parent's label: `label: c[0]!.label`.

## Smallest correct fix

Make the effective label the highest label on the chain, at both read sites:

    // kernel/src/authorize/index.ts, replacing `let label = res.label;`
    let label = chain.reduce((m, r) => Math.max(m, r.label), res.label);

    // kernel/src/authorize/scope.ts aclIds: compare the same chain maximum, not r.label
    const eff = chain.reduce((m, a) => Math.max(m, a.label), 0);  // then `eff > g.ceiling`

Why here and not at birth:
- A label copied when the item is born misses an item moved into the folder later (`vault.item.move`).
- It also misses a folder relabelled after its items exist.
- It needs a data repair for existing rows.

Reading the chain covers all three cases with no migration, and it applies the same rule to Files folders, record types and anything else with a parent.

## Check before landing

- **Public links.** Anything deliberately less sensitive than its parent stops working, such as a `public` file under an `internal` folder that a share link relies on. Grep `label: "public"` and the share-link and portal paths, and decide whether `public` is meant to escape its parent. If it is, take the maximum only over ancestors whose label is above `internal`, or treat `restricted` alone as inherited.
- **Space root.** The chain ends at the Space resource (label 0), so the maximum never lowers a label.
- **Tests.** Add a kernel test: an item under a Restricted folder is `above_clearance` for a Member and listed for an Admin. Add a live test that moves an item into the folder and relabels the folder.
- **Labelling workarounds.** sso-save, storeInVault, companyFolder, the Space key and the daemon all label each item. They become redundant but harmless, so keep them.

## Fixed (lane l-labelinherit, 3 Nov)

The effective label of a resource is the highest label on its chain: its own and every folder above it. A resource cut off from its container (Only people added, Only me) still carries the container's label, because the cut stops grants flowing down, not sensitivity.

- **kernel/src/authorize/snapshot.ts** `effectiveLabel(id)`: walks the chain once and memoises the answer for the resource and every ancestor on the way, so n items in one folder read n rows plus the folder's chain once. Any `putResource` (a label set, a move, a new resource) drops the cache with the other derived views. The access module builds a new snapshot on every epoch, so its cache never outlives a change.
- **kernel/src/authorize/index.ts** `authorize`: `label` starts from `effectiveLabel`, so clearance, grant ceilings and the provider-label policy all see the inherited label. A create takes the container's effective label.
- **kernel/src/authorize/scope.ts**: `aclIds` compares grant ceilings with the effective label. `scopeFor` passes the rows whose folders raise their label (`liftedLabels`) to `label_le`, which `evalPred` reads and `toSql` turns into `id NOT IN (...)`. The property test still proves authorize, the predicate and the SQL agree.

The note's claim that reading the chain covers moves was wrong in one way: a move did not change the chain. `vault.item.move`, `files.move` and `files.folder.move` left the access resource under its old folder, and a Vault folder made inside another was registered under the Space. Both are fixed in **host/src/gateway/resources.ts**: `vault.item_moved`, `file.moved` and `folder.moved` register the object again under its new folder in the same commit, keeping its label, owner and holds, and a Shared Vault folder made with a `parentId` lives in that folder. Vault folders that were nested before this keep the Space as their parent until they are moved.

Files keeps its own copy of folder labels (`files_folder.label`). `files.get` and every file row now report the folder chain's label (`labelOfFolder`, read once per folder per call), so `portal.file_link`, which refuses anything above Internal, sees it too. `files.share_external` checks the whole chain, not only the folder the file is in.

## Public links inside a Restricted folder (lead ruling 3 Nov)

Lead ruling, 3 Nov 2026: refuse. No public link is made for anything Restricted, by its own label or by any folder above it.

- `access.share` with a `link` subject (and `vault.share`, which calls it) answers `validation.precondition_failed` when the resource's effective label is Restricted. The same check runs when an existing link grant is updated, so a link cannot be extended once its folder is Restricted.
- `files.share_external` answers `permission.above_clearance` for a file anywhere below a Restricted folder.
- Links made before the folder became Restricted are not kept working. Nothing opens one today: access link grants have no reader, `files_external_link` has no `/x/` route, and `portal` `redeemFileLink` has no caller. Whatever opens a link must check the effective label at the moment it opens and refuse at Restricted. That check needs no migration.
- Confidential is unchanged: a file in a Confidential folder may still have an outside link, as before.

Tests: kernel/tests/authorize.label-inherit.test.ts, host/tests/labels.inherit.live.test.ts, host/tests/resources.created.test.ts (moves), modules/access/tests/share.test.ts and modules/files/tests/viewer.test.ts (links).
