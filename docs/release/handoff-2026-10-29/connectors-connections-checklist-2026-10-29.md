# Connectors and Connections completion checklist

Agent auth068_completion owns this bounded follow-up after Comms commit 5de7f71c. Root owns Webhooks and View-as, Integrations.tsx and shared.tsx. New Connectors.tsx, Connections.tsx and local helpers/tests only. Await root's integrated base before changes.

| Page | Existing contract work | Acceptance |
|---|---|---|
| Connectors | Typed mode draft creation; named/paged ObjectList; live get ObjectPage; real test-case results; request build with notes/docs; actual file diff; reviewed publish with returned published/result; real versions/rollback; remove impact; export opens actual Files folder | Fresh daemon create/readback/reload, test/diff/publish/version/rollback/remove, actual Files target; phone/dark captures |
| Connections | Live connector selection; ownerKind constrained to connector scope; Vault metadata handle picker with no values; provider scope chips; real create/authUrl; named/paged list; live get; rename/scopes; test details; pause/resume; truthful reconnect/provider continuation; delete impact | Fresh daemon supported connector create/readback/reload/lifecycle; no fake provider sign-in, no secret reveal; phone/dark captures |

Contract boundaries from code:
- modules/connectors/handlers/connections.ts: secrets map holds Vault handles matching #Name or #Name.field only. Creation may return an actual authUrl; state stays pending until actual provider callback/probe. No OAuth result is simulated.
- Connector get/list exposes secret metadata (name/description), domains, actions and scope. It does not expose an auth scope catalog. User-entered provider scope chips must stay honest strings; no invented provider enum or implied validation.
- vault.items.list exposes metadata handle and fieldKeys. The page never calls reveal or displays credentials.
- modules/connectors/handlers/runtime.ts: build requests runs.start and clones a draft. A requested build is not proof of a finished connector. UI must state request result and present real diff/test results before publication.
- Builtin connectors cannot publish/remove. Remove also deletes its connections, drafts and versions; synced type binding can block removal. Review must state consequences.
- Export returns folderId only after actual Files write; openApp must target the real Files folder. Never show an exported success after an unavailable Files error.
- Ownership can only be current person or Space, and must equal connector.scope. Another person's private connections remain hidden by backend.


## Verified final acceptance, 29 October 04:15 PKT

Function: 2/2 DONE for existing supported contracts. Primary real browser: 2/2 DONE. Visual: 2/2 Graphite desktop and Paper phone DONE, actual skin attributes asserted and dark capture visually inspected. Fresh claimed daemon on current root77a76524 plus trusted read fix; artifact `/tmp/vyre-webhooks-web2`. `/tmp/vyre-integrations-current-root-final.log`: 9/9 passed in19.4s.

- Connector: typed webhook draft creation; actual framework tests; real build run request; file diff; reviewed publication; two published versions; rollback; readback/reload; real Files export returned a folder that opened in Files and passed files.folder.get; reviewed deletion.
- Connection: actual live connector account creation, title/scopes update, test details, pause/resume and reload; non-OAuth reconnect remains Pending and does not invent a provider sign-in; reviewed deletion.
- Vault metadata: actual shared Vault folder/item created through canonical capabilities using an explicit fake fixture value; UI picked its named field. Connection request carried only #handle.token. Browser never called reveal/use/fill, and neither its DOM nor connection request contained the fixture credential value.
- Actual Graphite and390px phone layouts show no horizontal overflow. Images: `/Users/irfad/Downloads/Vyre-v1-RC-screens/integrations-console/connector-desktop-dark.png`, `connection-desktop-dark.png`, connector/connection-phone-light.png, connector-files.png, connection-vault-reference.png. Ignore the earlier failure-integrations.png debug capture.
- Source handoff a250e425 integrated8266daf5; connector creation manifest bug ee78cdb1 integrated2177ec16. Source strict semantic diagnostics0, model/SSR focused2files green. Backend worker landed real authorized Files writer5f0903a5 and private-root ancestry protection0d6393cd, root77a76524/91d72372; no fake folder accepted as proof.
- Boundaries: no external provider sign-in, purchase, live API request or OAuth token exchange is claimed from these local fixtures. A build request is not represented as an agent's completed implementation; the UI shows actual diff/tests/publication returns. Scopes remain honest provider strings because the exposed connector contract carries no provider scope catalog.
