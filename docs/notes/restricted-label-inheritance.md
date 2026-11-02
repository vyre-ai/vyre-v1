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
