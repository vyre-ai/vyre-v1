# Deferred capabilities

Ruling 60: a capability whose packet is deferred is registered with the shared helper `host/src/routes/deferred.ts` (`deferredHandlers`). It refuses with `internal.unavailable` and the message "Not in this version yet". The module is live with every other capability real. The deferred packet replaces the stub later.

| Module | Capabilities | Why | Swap |
|---|---|---|---|
| reports-client | all 9 (`reports.*`) | Report a problem goes in the polish pass; needs the reports.vyre.run client and the replay sandbox. Its table is `reports_client_report` (the host accepts only `<module id>_*` tables) | one line in `modules/reports-client/impl.ts` |
| sites | all 23 (`sites.*`) | Sites goes in the polish pass; needs the Docker runtime, Caddy router and DNS check drivers | one line in `modules/sites/impl.ts` |
