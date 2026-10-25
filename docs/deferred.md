# Deferred capabilities (ruling 60)

A capability listed here has a registered handler that refuses with `internal.unavailable` and the message "Not in this version yet" (`host/src/routes/deferred.ts`). Its module is live with every other capability real. The deferred packet replaces the entry.

| Module | Capability | Packet |
|---|---|---|
| vault | providers.add, providers.catalog, providers.list, providers.remove, providers.set_space_use, providers.subscription_complete, providers.subscription_start, providers.test | P-L7_11 |
| vault | vault.import, vault.import_parse, vault.generate, vault.health | P-L7_11 |
| vault | vault.folders.update, vault.folders.delete, vault.items.export_mine, vault.items.match, vault.policy.get, vault.policy.set, vault.site_rules.list, vault.site_rules.set | no packet yet (listed on P-L7_LIVE) |
