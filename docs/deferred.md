# Deferred capabilities (ruling 60)

A capability listed here has a registered handler that refuses with `internal.unavailable` and the message "Not in this version yet" (`host/src/routes/deferred.ts`). Its module is live with every other capability real. The deferred packet replaces the entry.

Ruling 93 (26 Oct): Vault import ships in v1.1, not v1. v1 counts golden flows 1 to 15; flow 6 is Sites as routes (owner, 2 Nov).

| Module | Capability | Packet |
|---|---|---|
| vault | vault.import, vault.import_parse | P-L7_11; ships in v1.1 (ruling 93) |
| reports-client | reports.resolved | The inbound webhook from reports.vyre.run (POST /hooks/reports): needs the service's signature check and a route to this module. The rest of Report a problem is real: the host wires the bundle sources and the signed client (host/src/seams/reports.ts); the replay sandbox is not wired |
| sites | sites.build, sites.previews, sites.preview_rebuild, sites.preview_remove, sites.table_create, sites.tables, sites.table_promote, sites.staging_password_set, sites.service_identity | The staging, preview and site-table pipeline. Owner, 2 Nov: a site is a route; owner, 3 Nov: Vyre also deploys a site from its source like Railway, so sites.deploy, deployments, rollback, env_set and env_list are live again on a new implementation (modules/sites/handlers/release.ts). The rest of Sites is live (handlers/route.ts); golden flow 6 covers it |

The providers capabilities (list, add, remove, test, sign-in) are real, not deferred: the engine needs them for every turn.

Not a deferred packet but not built either: `access.propose_change` still answers "this capability is a later packet" (modules/access/handlers/index.ts); it is listed here so nothing is surprised by it.

Space administration gaps (P-L7_LIVE; the capabilities answer, the effect is limited):

| What | Today | Until |
|---|---|---|
| `spaces.switch_address` | records the address on the profile (invite links use it); does not reconfigure Caddy or the relay | the network module reconciles routes from the profile |
| `spaces.delete` | refused over HTTP (internal.unavailable); a Space is removed on its server with the command line | by design |
| Space key fingerprint (`spaces.get`, join page) | a placeholder derived from the Space id | an admin device sets the real fingerprint; devices must not pin it |
