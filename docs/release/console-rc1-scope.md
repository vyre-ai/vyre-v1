# Console RC1 scope ledger

Current source: isolated codex/rc1-console-critical, based routing d0e6cc3c. Draft PR #762. Production browser acceptance passes the real critical workflows below; exact CI release evidence remains required. Partial entries do not count as full v1 page completion.

Historical build/P-L7b_11 at333b3a02 supplies only shell, Overview, Audit. No later Console page branches exist locally. Generic unimplemented error screens do not count as complete.

| Page | Screen | State |
|---|---|---|
| Overview | `console.overview` | Historical Overview + real console.overview projection; focused SSR pass, production pending. |
| People | `access.people` | Partial: member list/invite/suspend + principal role assignment. Missing full person object tabs, effective-permission/owned-resource drilldown, removal wizard, reset contract, filtering/bulk actions. |
| Groups | `access.groups` | Missing functional UI; historical navigation definition only. |
| Roles | `access.roles` | Partial: list/clone/permission preview+apply. Missing full grouped permission matrix, holder/clearance/activity tabs, rename/delete and bulk/filter interactions. |
| Grants | `access.grants` | Partial: list/share/revoke by resource. Missing conditions/expiry editing, full inherited-access explanation and bulk/filter interactions. |
| Policies | `access.policies` | Missing functional UI; historical navigation definition only. |
| Access checker | `access.checker` | Real access.check decision/steps; production pending. |
| Access reviews | `access.reviews` | Missing functional UI; historical navigation definition only. |
| Sessions and devices | `devices.sessions` | Partial: devices list/detail/session or device revocation with confirmation. Missing full device object views, filters and bulk actions. |
| Agents register | `console.agents-register` | Missing functional UI; historical navigation definition only. |
| Outside actors | `console.outside-actors` | Missing functional UI; historical navigation definition only. |
| Agent computers | `console.agent-computers` | Missing functional UI; historical navigation definition only. |
| Agent template | `console.agent-template` | Missing functional UI; historical navigation definition only. |
| Schema | `console.schema` | Missing functional UI; historical navigation definition only. |
| Sensitivity labels | `console.labels` | Missing functional UI; historical navigation definition only. |
| Retention | `governance.retention` | Missing functional UI; historical navigation definition only. |
| Holds | `governance.holds` | Missing functional UI; historical navigation definition only. |
| Erase a person | `governance.erase` | Missing functional UI; historical navigation definition only. |
| Backups | `console.backups` | Partial: local target config/run/list/verify/restore preview+confirmation; staged restart behavior. Missing S3/drive target configuration, backup deletion and full owner export UI. |
| Export | `console.backups` | Missing functional UI; historical navigation definition only. |
| Models and providers | `console.ai-models` | Missing functional UI; historical navigation definition only. |
| Gate rules | `gate.rules` | Missing functional UI; historical navigation definition only. |
| Spend and limits | `console.ai-spend` | Missing functional UI; historical navigation definition only. |
| Logging | `console.logging` | Missing functional UI; historical navigation definition only. |
| Review sampling | `console.ai-review` | Missing functional UI; historical navigation definition only. |
| Incidents | `console.ai-incidents` | Missing functional UI; historical navigation definition only. |
| AI use policy | `console.ai-spend` | Missing functional UI; historical navigation definition only. |
| Sending domains | `mail.domains` | Missing functional UI; historical navigation definition only. |
| Numbers | `telephony.numbers` | Missing functional UI; historical navigation definition only. |
| Shared inboxes | `mail.shared-inboxes` | Missing functional UI; historical navigation definition only. |
| Texting registration | `telephony.registration` | Missing functional UI; historical navigation definition only. |
| Connectors | `console.integrations` | Missing functional UI; historical navigation definition only. |
| Connections | `console.integrations` | Missing functional UI; historical navigation definition only. |
| Webhooks | `events.webhooks` | Missing functional UI; historical navigation definition only. |
| API keys | `console.mcp-sessions` | Missing functional UI; historical navigation definition only. |
| Network | `console.network` | Missing functional UI; historical navigation definition only. |
| Server | `console.server-logs` | Missing functional UI; historical navigation definition only. |
| Audit log | `audit.log` | Historical Audit filters/search/detail via audit capabilities; focused SSR pass, production pending. |
| Space | `spaces.console` | Missing functional UI; historical navigation definition only. |

Additional current console.nav entries now registered in the restored frame but missing functional content: Usage (`console.usage`), Updates (`console.server-updates`), Diagnostics (`console.diagnostics`), Support bundle (`console.support-bundle`), Speed (`console.speed`). All missing functional UI. Current server nav is authoritative for permissions. Historical aliases Export/Backups, AI use policy/Spend, Connectors/Connections require explicit distinct functional work rather than treating the shared screen as completion.

No product-owner decision blocks the approved first pages. Full Console remains v1 scope; completing it requires implementation and release tests for every missing page. This ledger does not defer any page to v1.1.

Production evidence (Node24, normal Expo production export): real local encrypted backup creation, verification and confirmed restore staging; second device revocation rejects its bearer and preserves the current bearer; invite creation; role clone, permission diff and apply; grant add/revoke; access-check allow decision; returning to the app. Project/record/file double-click, reload/back/deep-link acceptance also passes on this stack. Restore restart/apply remains covered separately by the backend restore acceptance; this UI test confirms staging only.

Backend navigation also needs explicit spec reconciliation: the current server-pruned console.nav has no Comms entries (Sending domains, Numbers, Shared inboxes, Texting registration), no distinct Export or AI use policy page, and combines Connectors/Connections. Existing historical labels do not establish working navigation or functionality.
