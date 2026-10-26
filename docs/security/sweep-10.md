# Security sweep 10 (P-SEC_10)

Two questions, after rulings 67 and 70: who can arrive as a trusted service, and which module keeps a private copy of access that a revoke would not reach. Proof is `host/tests/security.sweep10.test.ts`, a booted daemon driven through the real gateway, plus the unit tests named below.

## 1. Trusted services

**What the gateway can produce.** `daemon.ts` builds a principal in two places: `identify` (a person, from the admin token or a device session) and `preAuthSession` (an `actor` named `act_anon_<hex>` or `act_pending_<hex>`, ruling 67). Nothing is read from a header or a body field. A service principal exists only inside the host (`svc_host`, from the hooks, the scheduler and the engine seams) or as a module's nested call keeping the identity it was called with. The sweep test sends the owner, a member, an agent acting for a member, the admin token, a real device session and a signed-out caller, each plain and with every forged header and body field it could think of (`x-vyre-principal-kind: service`, `svc_host` as token, device, actor, `preAuth: true`, `actingFor` another person...). The caller is always what the session says, and a nested `ctx.call` has the same kind, id and actingFor at depth one.

**The overloaded word.** "Service" is not one thing. The host's own services (`svc_host`, `svc_engine`, `svc_sync`) are system; but a Space Automation runs as its own `svc_<32 hex>`, a public form submits as `svc_form_<id>` and a site container as `svc_site_<hex>`, and those hold only the grants they were given. Every module below treated any `kind === "service"` as the host. Fixed by `lib/trust.ts`:

| Predicate | Meaning |
|---|---|
| `isHostService(p)` | kind service and id exactly `svc_host` |
| `isTenantService(p)` | a service a tenant can create (`svc_form_*`, `svc_site_*`, `svc_<32 hex>`) |
| `isTrustedService(p)` | a service that is not a tenant's: what "a service caller acts for every slot" means now |
| `isSystemCall(ctx)` | the host, or a call another capability made (depth above zero); a direct gateway call is never one |

### Fixed

| # | Finding | Fix | Files |
|---|---|---|---|
| F1 | `mcp.session.mint` (permission none, level edit) let any member name any principal and acting-for person and get a session token for it: impersonation of the owner. | host or nested call only | modules/mcp/handlers/server.ts, projections.ts, fixtures/harness.ts |
| F2 | `scheduler.schedule` let any service name any `principal`: a Space Automation could schedule a call that runs as the owner. Same trust in scheduler list and missed. | `isTrustedService` | modules/scheduler-api/projections.ts |
| F3 | Gate: any service passed `mayHandle`, so an Automation could see and handle the holds on its own acts. Tasks: any service acted for every slot, skipped the self-review and human-approver rules, and could move a gate task. | `isTrustedService` | modules/gate/projections.ts, modules/tasks/projections.ts, handlers/state.ts, handlers/act.ts |
| F4 | Runs listed every Run, Home read any digest, Notifications gathered any person's digest for any service (and for a kind `automation` that is not a principal kind at all). | `isTrustedService` | modules/runs/projections.ts, modules/home/projections.ts, modules/notifications/projections.ts |
| F5 | Google and Microsoft let any service act as any mapped mailbox (`as:`), and read the subscriptions of anyone. Automations let any service manage any Automation. | `isTrustedService` | modules/google/projections.ts, modules/microsoft/projections.ts, handlers/subscriptions.ts, modules/automations/handlers/defs.ts |
| F6 | `audit.append`, `audit.archive`, `audit.checkpoint` (permission none, level view) were callable by any member: forged rows with a chosen `onBehalfOf`, and an archive with a cutoff in the future moves the whole trail out of the log everyone reads. | system call only | modules/audit/handlers/log.ts, projections.ts, fixtures/db.ts |
| F7 | `devices.epoch_bump` let a member advance anyone's epoch, which purges that person's devices. `devices.touch` and `devices.purge_ack` took any device id. | bump: system call or own epoch; touch and ack: own device or system call, a stranger's device reads as missing | modules/devices/handlers/sessions.ts, projections.ts, fixtures/db.ts |
| F8 | `vault.report_scrub_miss` let a member raise a scrub-miss alarm on any item. | system call only (permission.no_grant) | modules/vault/handlers/use.ts, projections.ts, fixtures/harness.ts |
| F9 | `host/tests/l7.live.test.ts` used `audit.append` by the owner as its write probe. | now probes `audit.verify` and asserts the refusal of a direct append | host/tests/l7.live.test.ts |
| F11 | `runs.start` accepted any `owner`: a member could start a Run owned by someone else, and a failed Run puts an Unblock task in that person's Needs you. | a direct caller names themselves or the person they act for; the host, a nested call and a trusted service (routines, connectors, journeys, governance, meetings) still start Runs for others | modules/runs/handlers/engine.ts, projections.ts, fixtures/db.ts, fixtures/seed.ts |
| F12 | `projects` `allows()` returned true when a ctx had no `authorize`. | returns false: a ctx that cannot ask has no answer to give | modules/projects/projections.ts |
| F13 | `governance.jobs.tick` (level view, no permission) let any member run a retention job early. | the host or a nested call, or someone who holds `policy.manage` (the scheduled call runs as whoever scheduled it, an admin who pressed Run now); anyone else is refused | modules/governance/handlers/retention.ts, projections.ts, fixtures/harness.ts |
| F14 | `gate.park` took `principal`, `actingFor`, `capName` and `input` from the caller. `gate.release` later re-invokes the parked capability as the hold's principal, and its self-approval check covers person principals only, so a hold a member wrote was an impersonation path. | only the pipeline parks: the Gate hook (origin `gate`), the host, or a nested call | modules/gate/handlers/hold.ts, projections.ts, fixtures/db.ts, fixtures/seed.ts |
| F15 | `projects.share_out` links never expired and could not be revoked, and the host route did not exist. | links expire in 30 days by default (`expiresInDays` 1 to 365, or `expiresAt`); `projects.unshare_out` revokes one at once; `GET /share/project/<token>` is served by the host through the host-only `projects.shared_view` and shows title, status, goal, the latest update and the next milestones only (no people, threads, files or assignees); an unknown, expired or revoked token is one 404 | manifests/projects.ts, modules/projects/handlers/project.ts, index.ts, host/src/routes/share.ts, host/src/daemon/daemon.ts |

### Reviewed and left (kind service stays a decision here, on purpose)

| Site | Why it is right |
|---|---|
| devices/handlers/register.ts | kind service and id `svc_host` (P-SEC_08) |
| forms/handlers/submit.ts | a public form may only use its own `svc_form_<id>` |
| chat/handlers/private.ts | the runtime opens a private chat only when asker and owner are the same person |
| automations/handlers/triggers.ts | the vault names a tenant service may use: a restriction, not a power |
| git/handlers/ops.ts, telephony/projections.ts | a label for the log, no decision |

The test `every module trust of kind service is reviewed` fails when a module adds a new `kind === "service"` until it is read and listed here.

## 2. Private copies of access

What each module that keeps rows about who may do something does, read against ruling 70 (the daemon's authorize reads the access module's snapshot, refreshed on every change).

| Module and table | Verdict |
|---|---|
| access (`access_*`) | the source. A suspension takes effect on the next call (booted test). |
| chat `chat_thread_member`, `chat_thread_agent` | chat's own data: private chats answer to their members by design, not a copy of a Space grant. Removing a person from the Space blocks them at the gateway before any handler. |
| projects `projects_member` | a mirror of `access.share` grants tagged `project:<id>`; reads use `ctx.authorize`, and removal calls `access.unshare`. A direct revoke in access leaves a stale row that shows a member the kernel no longer honours; the display, not the decision. |
| automations `automations_access` | written, never read for a decision (a record of the confirmed diff). `automations_vault` only narrows. |
| google/microsoft `*_member` | the mapping of a person to a mailbox; the person must still pass the gateway, and an agent acting for a removed person is stopped by `actingFor` authorization. |
| campaigns `campaigns_member` | recipients, not access. |
| **sites `sites_grant`** | **a frozen copy.** It recorded what the owner could do when the site was made and `sites.service_identity` handed it out forever. A revoke, a demotion or an offboarding of the owner never reached the site. **F10 fixed:** every grant is checked with `access.check` against the owner at each ask; a check that cannot be made hands out nothing. modules/sites/handlers/deploy.ts, fixtures/world.ts, tests/deploy.test.ts. |
| projects `projects_share` | **fixed (F15).** A bearer token for a read-only link. Every link now has an expiry, can be revoked by deleting its row, and is served by the host through a capability that checks the row on every request. The creator's standing is not rechecked at view time: the link is a deliberate grant by a person with Manage on the project, withdrawn by revoking it or letting it expire. |

## 3. Left for follow-up

- `projects.projects_share` does not recheck that the creator still manages the project when the link is opened. Revoking a person's access does not withdraw links they made; the project's Leads revoke them (`projects.unshare_out`), and every link ends within 30 days by itself.
- The shared link route has no per-address rate limit. The token carries 144 random bits, so guessing is not the risk; add one if the page ever serves large files.

## 4. Index query for `files.versions_purge`

Landed with P-CC_39 (the capability does not exist on main until that packet merges); see the change note at the end of this file once it is in.
