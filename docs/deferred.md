# Deferred capabilities (ruling 60)

A capability listed here has a registered handler that refuses with `internal.unavailable` and the message "Not in this version yet" (`host/src/routes/deferred.ts`). Its module is live with every other capability real. The deferred packet replaces the entry.

| Module | Capability | Packet |
|---|---|---|
| vault | vault.import, vault.import_parse, vault.generate, vault.health | P-L7_11 |
| vault | vault.folders.update, vault.folders.delete, vault.items.export_mine, vault.items.match, vault.policy.get, vault.policy.set, vault.site_rules.list, vault.site_rules.set | no packet yet (listed on P-L7_LIVE) |

The providers capabilities (list, add, remove, test, sign-in) are real, not deferred: the engine needs them for every turn.

Not a deferred packet but not built either: `access.propose_change` still answers "this capability is a later packet" (modules/access/handlers/index.ts); it is listed here so nothing is surprised by it.

Space administration gaps (P-L7_LIVE; the capabilities answer, the effect is limited):

| What | Today | Until |
|---|---|---|
| `spaces.switch_address` | records the address on the profile (invite links use it); does not reconfigure Caddy or the relay | the network module reconciles routes from the profile |
| `spaces.delete` | refused over HTTP (internal.unavailable); a Space is removed on its server with the command line | by design |
| Space key fingerprint (`spaces.get`, join page) | a placeholder derived from the Space id | an admin device sets the real fingerprint; devices must not pin it |
