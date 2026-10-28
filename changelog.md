- Desktop Personal Space creation starts a separate managed local profile, preserves the device daemon, and reuses the real owner claim flow inside the packaged app. Validated local handoff and single-flight startup prevent duplicate creation and remote endpoint injection. A persisted UUID keeps the Space identity across port changes, and authenticated HTTP shutdown now resolves the daemon entry point cleanly.
- Allow only exact packaged desktop origins to reach capability/sync/local-key APIs across origins, with validated preflight headers and unchanged bearer authentication.
# Changelog

- Keep browser failure diagnostics from masking the original Apps failure, and verify the canonical wording in exported AI policy documents.
- Restore the auth entry chooser and canonical invite links, connect Add a Space on desktop and phone, keep Get started available before choosing an address, and add password-based Lock/Unlock using the existing session revocation and key-drop path. Preserve the approved clean 0.6.8 auth kit and signed-in v1 visual language.
- Kept the audited Speed trace drilldown on a direct authenticated read, matching Server trace handling and avoiding repeat reads from global query invalidation.

- Pinned server updates to the reviewed channel, version, artifact hash and signed feed before installation. Reject changed artifacts before download, validate updater flags before action, persist the daily channel/feed only after healthy success, and stop dry-run before unpack/image/backup steps. Added actual HTTP installer-argument proof and POSIX signature/pinning/dry-run/rollback regressions.

- Bound backup restore confirmation to the latest selected backup: clear prior confirmation during loading and on failure, ignore delayed or cancelled previews, show the selected backup date, and prevent confirming a removed backup. Added forced-order regressions and production browser proof using two actual local backups without executing restore.

- Closed the view-level Space address mutation path: require server.network manage, verify DNS and apply the real host driver before saving the profile, and show the observed current address after Network changes. Missing drivers and failed DNS/Caddy applications preserve prior state. Added actual HTTP view-only denial, owner success/failure and restart regressions.

- Wired network domain changes to the existing Caddy ingress driver and added sanitized pending/applied/failed outcome readback. Preserve observed address and server rows until host operations succeed; retain prior state on driver failure, restrict renewal to current Space ingress, and refresh its observed certificate. Mark absent compute enrollment unavailable. Return server budget units and direction with Speed rows through the capability boundary. Added driver, HTTP permission/failure/event/restart and browser regressions.

- Routed the Console Network and Speed entries to their live pages and separated Usage from the AI Spend editor.

- Added typed Console Network, Speed and Usage pages with reviewed network changes, observed status, performance budget units and trace drilldown, and independent usage grouping. Fixed the first successful queued domain apply leaving the reported address stale. Added production browser coverage and command failure regression.

- Mark the synthetic export-redaction credential fixture for the existing secret scanner without changing production credential checks.

- Verify imported Claude Code and Codex checkout identity across Git's Windows path spelling and Windows canonical extended-length paths, while retaining exact provider-to-provider metadata agreement.

- Matched non-Welcome auth forms to the 0.6.8 content-height reading frame, small Vyre mark and top Back action, with a full-width primary below the fields. Preserved the approved flat surface, restrained halftone and existing account/security contracts. Made username/password fields fill the reading column and refresh the verified Space name without discarding typed credentials or in-flight sign-in. Scope delayed metadata to the destination host and origin, remount credentials when the address changes, and prevent duplicate pending sign-in requests.

- Restored the 0.6.8 welcome composition: open halftone canvas, approved Vyre mark, large greeting and round Space connection field, with verified v1 connection and retry handling.

- Fixed invited-account AI setup through the member acceptance contract so invite permissions apply before session verification: provider choice and Mine API-key storage follow verified join; subscription sign-in uses real completion, failures retry without accepting the invite twice, and raw keys never enter device storage. Preserved the authenticated device session during password changes while revoking other devices. Added working password and authenticator controls and truthful account-recovery guidance.

- Fixed fresh desktop connection: the first launch now accepts and verifies a Space address before sign-in, with retryable connection errors and the existing verified session persistence.
- Filed imported Codex and Claude Code archives now appear inside their Personal Project's Chat tab, where owners can read the immutable history, continue it with their assistant, or reopen its continued chat.
- Added an authenticated standalone Console frame with server-pruned navigation (including registry and loading-state coverage for nine app places plus the standalone Console) and real Overview, Audit, Backups, Devices, People, Roles, Grants and Access checker surfaces. Backup restore requires a preview and explicit confirmation; device revocation retains purge handling. These pages deliver the tested critical workflows; full page scope and the other Console pages remain incomplete, as listed in docs/release/console-rc1-scope.md.

- Restored Records and Files item routes: real record/project pages and plans, file previews, folder links, and browser URL history now follow the selected item, including copied links, project tabs and reloads. Removed an unused viewer barrel so every restored production file has executable coverage.

## Unreleased
- Governance hold lists now resolve held people through the authoritative principal directory instead of exposing raw person IDs.
- Welcome uses stable exported markup before showing the device's local greeting, preventing hydration failures after a time-zone change or midnight.
- Browser release evidence requires the real Forms/Campaigns/Apps surface instead of accepting the retired Sites placeholder or its error state.
- Console Sensitivity labels now use named resource and record-type pickers, verify schema-label readback, and let owners apply individual scan suggestions.
- Console Schema now offers the server-declared field types as a named picker instead of asking administrators to type internal field-type keys.

- Match the Files folder-search backend limit and wait for a name before querying. Actual production browser17/17 now proves named grant creation, one-week expiry edit, retained backend state after reload/revocation and named Checker decisions.

- Replaced Console Grants and Checker identifier inputs with authorized named resource and subject pickers. Grants supports reviewed creation, retained-bound level/expiry edits and resumable bulk revocation; Checker uses typed levels, catalogue permissions and the agent’s acting person. Added focused tests and production mutation/readback/reload coverage; production browser verification is pending the shared disk/build pause. Owner is excluded from invite role choices.

- Completed the typed invite fixture used to prove policy rejection leaves invites and account state unchanged; focused semantic and runtime checks pass.

- Closed a grant escalation path: grant updates and share upserts now require independent current resource authority and retain its level, expiry/window, row-filter, hidden-field and declared sensitivity bounds. A grant cannot renew itself. Validate every condition before mutating the grant and preserve issuer/source. Actual HTTP escalation/contained delegation/rollback/restart regressions pass with existing sharing properties.

- Added typed Console Policies objects, reviewed public-link and sign-in editors, prerequisite-backed authenticator setup, indexed Activity and links to the owning AI/Data controls. Production browser proves public-link save/readback/reload plus dark/fresh-phone rendering; required MFA remains unavailable until the server supports invited-member enrollment. Fixed direct-read enable transitions.

- Enforce the current Space sign-in policy at authentication and session issuance through a typed read-only host port. Only advertise implemented methods; reject password lockout, unsupported SSO and required MFA without actual Owner enrollment and a supported new-member enrollment path. Reject unavailable invite sign-up before accepting the invite or creating an account. Added real HTTP authentication/readback and policy Activity regressions.

- Added typed Console Policies objects, reviewed public-link and sign-in editors, prerequisite-backed authenticator setup, indexed Activity and links to the owning AI/Data controls. Production browser proves public-link save/readback/reload plus dark/fresh-phone rendering; required MFA remains unavailable until the server supports invited-member enrollment. Fixed direct-read enable transitions.

- Enforce the current Space sign-in policy at authentication and session issuance through a typed read-only host port. Only advertise implemented methods; reject password lockout, unsupported SSO and required MFA without actual Owner enrollment and a supported new-member enrollment path. Reject unavailable invite sign-up before accepting the invite or creating an account. Added real HTTP authentication/readback and policy Activity regressions.

- Authorization tests: keep the unchanged 200-world SQL/predicate property and its coverage floors, retain legacy Owner-group worlds, and add valid direct Admin diversity. Add a deterministic SQLite regression proving Owner-group denial while ordinary group/Admin grants survive.

- Console Access Reviews: add the shared review list/object, real start/keep/remove/close actions, reviewed grant removal, indexed Activity, and a tasks.get-backed review-task sheet. Expose existing reviewer/task links in the typed review response; preserve external Home task routing as a separate open gap.

- Console Access Reviews: add the shared review list/object, real start/keep/remove/close actions, reviewed grant removal, indexed Activity, and a tasks.get-backed review-task sheet. Expose existing reviewer/task links in the typed review response; preserve external Home task routing as a separate open gap.

- Outside actors: reject canonical Owner through create/update before mutating actor state, strip legacy non-person Owner authority, and preserve provider changes on validation failure. Update obsolete Owner fixtures while retaining agent/provider authorization coverage; use shared rows for actor roles and computer-agent choices.

- Console interactions: separate list keyboard focus from opening objects, restore Audit row context menus, fit standard object frames to phone widths, and regenerate approved Access/Audit contract snapshots. Production browser covers context keys, bulk selection, role diffs and dark/phone layouts.

- Administrative exports: recheck current authority and expiry after awaited blob reads; reauthorize across save waits and remove newly written blobs/metadata when revocation, registration or storage prevents completion.

- Access ownership: reject public Owner role assignment/removal for people and groups, ignore legacy group Owner inheritance, and keep ownership transfer as the single durable path updating both the Space owner and sole Owner assignment. Add real Admin HTTP denial and restart regressions.

- Console Roles: add the generated permission matrix, locked built-ins and staged exact-preview changes, plus object holders, clearance, grants and permission history. Persist the last successful permission diff and block deleting roles held by empty groups.

- Console Groups: add the shared searchable object list and object tabs, paginated member/manager selection, real group roles, grants and indexed Activity, with confirmed deletion and deep-link browser coverage. Reject invalid manager updates before changing the group.

- Access: allow validated group role assignments, expose direct holders, and enforce human-only role restrictions when groups gain agent members and when evaluating legacy assignments.
- Audit: add a bounded typed target filter for object Activity, indexed and hash-bound to declared metadata; preserve Space authorization and exclude credential values.
- Wired live invoke audit metadata into the append-only audit chain while retaining operational logs. Actor and on-behalf-of attribution and whitelisted object target IDs now reach Console Activity without copying request bodies or credentials. Generated permission metadata now loads in the browser for the real role matrix.
- Console object lists: pass row context-menu and keyboard-menu handlers through the supported web DOM seam so right-click and Menu-key actions work on shared rows.
- Console Agent computers: replace the raw agent-ID provisioning field with named eligible-agent choices and mark agents that already have a computer.
- Console Outside actors: filter Activity by audit target so owners see changes to the actor, including access, scope, Engineer MCP and revocation changes, instead of unrelated actions performed by that actor.
- Console Schema: construct Apply from the exact reviewed diff, including destructive confirmations and a fresh idempotency key, so the production control reaches `schema.apply` instead of failing locally before the request.
- Console object polish: resolve Agent, computer and outside-actor owners to human names, replace raw outside-actor role IDs with a named picker and add/remove review, and require impact confirmation before changing Engineer MCP access.
- Console Agents and Data: migrate Agent and Agent computer registers to the shared searchable object model with standard object tabs, impact-confirmed bulk/destructive actions and quick edits; replace raw Schema JSON operations with a typed record-type and field builder bound to exact diff previews.
- Console surfaces: wire capability-backed first implementations for Agents, Data, Comms and Integrations; Outside actors now uses the shared object model with production create/readback/edit proof, while the scope ledger names the remaining acceptance gaps for every other adapter.
- Console objects: wait for real asynchronous mutations before showing completion or Undo, preserve failed/held actions as visible errors, guard duplicate action submits, and synchronize externally changed tabs and quick-edit sheets.
- Console: add a shared searchable, filterable and keyboard-selectable object-list framework with checked filter counts, bulk selection, pagination and real row context actions; it composes with the existing standard object header, tabs and quick-edit sheet.
- Space archives: refuse snapshots while relevant writes are active, advance mutation revisions on completion, and enforce a cumulative retained-item budget across roots and descendants. Add deterministic HTTP coverage for writes blocked before the snapshot baseline and between DB/log phases.
- Label the fixed synthetic collector and HTTP archive credential fixtures with the documented secret-scan marker; keep production scanner enforcement unchanged.
- Space archives: collect current shared records/schema, retained file versions and canonical current pointers, public channel messages and Space settings through the original owner’s capabilities. Include an exact hashed manifest, explicit privacy/credential omissions and mutation guards through persistence; refuse missing snapshots and inconsistent exports instead of returning a partial ZIP.
- Space archives: recheck current owner, export permissions and expiry after blob retrieval before returning status or bytes; withhold ready pointers until resource registration finishes, and delete encrypted artifacts after failed persistence or registration.
- Console: add Updates review/history, Space profile and owner transfer controls, and local/drive/S3 backup settings with encryption and schedule readback. Add expiring current-owner archive status and authenticated chunked downloads; fix null-Space export authorization, atomically project ownership/resource/role changes across restart, and preserve the Space when server-side deletion refuses. Keep the existing shared-history-only export scope explicit.
- Console: add live Server logs, service restart review, storage probes, Diagnostics and Support pages with real requester-private downloads. Scope administrative export ports to approved handlers, preserve current permissions and actor attribution, scrub content, and expire encrypted artifacts and caches after 24 hours. Drain accepted log rows and spans before closing the sink and ignore late shutdown callbacks.
- Console Holds now renders verified placements immediately and removes verified releases immediately, without waiting for asynchronous live-query invalidation.
- AI/Data release evidence now saves named production screenshots for policy, incidents, Person holds, erasure previews, exports, typed Schema and sensitivity labels when a capture directory is supplied.
- Console Holds now finds current Space people from the authoritative principal directory even before the asynchronous global search index has projected them.
- Console Erase now pages through the complete tombstone history without duplicating refreshed findings.
- Console Spend can now page through every named Space agent before choosing an agent-scoped budget or pause control.
- Console AI review, incidents and spend now use the shared object-page and scoped-input contracts without optional-property ambiguity.
- Release evidence: drive production Console AI and Data policies through a fresh claimed Team daemon and require live mutation readback, readable policy export, typed schema field apply and named sensitivity-label readback in Chromium.
- Console erase: find a person by name, email or phone, review grouped expiring findings, select data kinds, require owner confirmation and a reason for hold override, and show the live erasure run and tombstone history.
- Console holds: search named people, files, folders, channels and threads, review hold impact, verify placement, paginate held targets, and require release confirmation.
- Console retention: edit global and per-record-type policies with typed durations, review and verified readback; reset overrides and start retention jobs with live state, removal and hold-skip results.
- Console AI review: paginate sampled turns within each review state, reset cursor state when switching views, and keep the latest unique turn status across pages.
- Console Gate rules: create first agent overrides from the inherited floor or Space rule, paginate the named agent picker, keep owner-floor changes owner-only, and verify saved rule readback before reporting success.
- Console AI incidents: show open, assigned and resolved incidents by default, paginate the full incident register without duplicate rows, and surface detail-read failures with retry instead of stale fallback data.
- Console AI spend: invalidate stale cap and raise reviews on every edit, apply only immutable reviewed payloads, verify cap readback, use native turn/minute units, and replace raw person, agent and pauser IDs with names.
- Console Gate rules: edit Space defaults, the owner floor, and named agent overrides across every Gate act with explicit approvers, timeouts, escalation and an impact review before apply.
- Console AI policy export: show the policy in force, including label-specific provider restrictions and loop limits, then export the audited policy file and open it in Files.
- Console AI incidents: add searchable/filterable incident objects, named owner assignment, notes, reviewed resolution, and person-report creation through the live incident contracts.
- Console AI oversight: configure turn logging and sensitivity-based review sampling through typed Space settings; review sampled turns on standard object pages and mark them fine or flag them into incidents with impact confirmation.
- Console AI policy: derive provider and model modes from the latest policy until editing begins, verify saved policy readback before clearing the draft, and retain restrictive empty per-label rules without allowing empty global selections to broaden access.
- Console AI spend: add Space/person/agent caps, reviewed limit edits, usage breakdowns, impact-confirmed global pause/resume, and one-time or permanent limit raises through the live engine contracts.
- Console AI policy: add typed provider, model, account and sensitivity-label controls with restrictive selected-only validation, reviewed policy application, and direct navigation to Vault for provider credentials.
- Console object lists: pass row context-menu and keyboard-menu handlers through the supported web DOM seam so right-click and Menu-key actions work on shared rows.
- Console objects: wait for real asynchronous mutations before showing completion or Undo, preserve failed/held actions as visible errors, guard duplicate action submits, and synchronize externally changed tabs and quick-edit sheets.
- Console: add a shared searchable, filterable and keyboard-selectable object-list framework with checked filter counts, bulk selection, pagination and real row context actions; it composes with the existing standard object header, tabs and quick-edit sheet.
- Console access checks render decision steps with the shared row component and named pass/fail indicators.
- Web startup: keep optional phone data, Console conversations, Plan views, telephony controls, and rich composers behind their owning lazy place chunks. Places still load required controls before the app marks them usable, while the signed-out first load falls from 1.71 MB to 1.36 MB raw without changing the 1.5-second phone budget.
- Local session import: converge concurrent confirmations on one immutable source archive instead of failing a unique-key insert after project creation.
- Desktop session import: keep provider roots and transcript paths behind native IPC, read committed Codex WAL rows without write access, move filesystem discovery off the app UI thread under one bounded Git-probe budget, recover Claude discovery when Codex metadata is damaged, attach CLI-only Claude repository identity after selected preview, keep native-verified repository roots authoritative over stale transcript metadata, normalize Codex and Claude checkout roots, and merge bounded Claude subagent history into its parent preview.
- Local session import: remove instruction/environment wrappers and redact credential patterns before preview and again before immutable archive or conflict storage.
- Personal history: connect native Codex and Claude Code discovery to selected transcript previews, explicit Personal import consent, owner-private archive reads, and linked continuation with copied visible context. Block Team imports, preserve import idempotency across the gateway, and let Personal project owners create projects without Team-only sharing calls.
- Personal history: file every continued repository session into its imported Project, while loose sessions remain in the owner-private archive without creating empty Projects.
- Vault routing: consume tab hashes for item sharing, folder export, Advanced, and pending requests; managers can fulfil or decline key requests without changing credential whitespace, list and revoke active export links, retry failed request/export reads, and open the live Backups, Devices, and Outside actors security surfaces instead of landing on inert placeholders.
- Release verification: fail the pinned startup gate when cold startup exceeds its unchanged budget, while allowing the remaining performance evidence to finish.
- Web startup: import production Inbox, shell-phone, and sidebar components from their leaf modules so screenshot sample fixtures and the generated screen registry no longer enter the initial common bundle through UI barrels.
- Records performance: reduce continuous-fling boundaries from eight rich rows to four while retaining twelve-row overscan, keeping forward, reverse, jump, and end-of-table viewports continuously covered.
- Web startup: keep the native FlashList runtime behind Metro's native platform boundary, preserving the existing windowed web list while removing native-only code from the production web entry.
- Files performance: bound each web virtual-list boundary swap to a small row batch, avoiding the 33 ms commit spikes caused by mounting dozens of rich Files rows at once, and invalidate cached windows when measured-row reflow moves the viewport beyond them.
- Release CI: give real signing, practice signing, and publication 30-minute bounded windows for the measured 127 MB desktop artifact download and release-asset transfer.
- Files performance: keep the web virtual-list window buffered across a fast fling and reuse one versioned sample snapshot for thumbnail reads, restoring the 10,000-file list to the 16.7 ms frame budget without dropping rows or changing grid behavior.
- Web startup: defer the authenticated shell, password-key implementation, and generated agent portrait catalog until they are needed, reducing the signed-out production entry from 2.42 MB to 1.74 MB raw without relaxing the 1.5-second phone budget.
- Release CI: measure the 25-minute tag budget at the live-and-deploy boundary, without waiting for native and desktop publication artifacts that do not block the live gate.
- Release CI: allow the desktop release assembly 15 minutes to download and verify the 125 MB macOS artifact instead of cancelling at the five-minute boundary.
- Auth: verify and persist the authenticated Space marker after owner claim so the new session opens the shell, keep SSR and the first browser render address-neutral to prevent hydration errors, and update the real-app invalid-session proof for address-scoped session storage.
- CI screenshots: split all-target visual capture into thirty-six deterministic shards, run production PWA and real-app evidence independently, and merge validated parts into the canonical `shots` artifact so the release proof fits its 35-minute gate.
- Terminal CI: retry removal of the real-tmux test home while server shells and control clients finish exiting, preventing a transient `ENOTEMPTY` after every behavior assertion has passed.
- Files: bind the large-upload helper used by host calls so agent-computer downloads above the direct-write limit reach Files intact instead of failing before blob storage.
- Files: propagate folder sensitivity changes into Access through a Personal-safe host seam, and filter listings, nested counts, tree and Trash badges, Trash rows, and Recent through live view authorization so restricted material disappears from agent computer mirrors without leaking its presence.
- Computer CI: clean up the hostile home-mirror escape fixture inside its container ownership context whether reconciliation leaves a symlink or replaces it with a real directory, without following the external target, and normalize the container command separator before checking mirrored file contents.
- Golden Flow 7: give each persistent fake-CLI send turn a distinct idempotency key, explicitly test a second independent Gate hold, and drive its delegated escalation and final drop at the scheduled test instants; the harness now has a typed multi-trace opt-in for this flow while every other flow remains single-trace by default.
- Golden Flow 7: provision its agent with the explicit least-privilege `comms.agent_send` role and verify a Resend sending domain before approval, so the Gate regression exercises the production authorization and provider path instead of relying on missing bootstrap grants.
- MCP/Gate: mount the live MCP runtime on the daemon's actual `/mcp` endpoint, advertise the bound loopback port to CLI engines, intersect outside Engineer tools with the live `engineer.mcp` permission, and return transport failures under the caller's JSON-RPC id so tool turns cannot hang.
- Desktop CI: give the installed-app relaunch its own bounded smoke-test lifecycle, use real macOS application-quit and Windows window-close paths, and require each packaged sidecar to stop so screenshot time and orphan processes cannot hide restart failures.
- PWA: add the production web manifest, Android/iPhone icons, Apple standalone metadata, safe-area viewport contract, truthful offline/update service-worker behavior, and an explicit Chromium iPhone-width smoke that labels standalone as simulated until the owner completes a physical iPhone Add to Home Screen pass.
- Release: gate tag publication on the exact-tag macOS desktop build; mount its verified ad-hoc-signed DMG, copy the app into a fresh install location, launch and relaunch it with sidecar smoke coverage, then publish the DMG with a SHA-256 sidecar. Windows remains CI-only coverage.
- Gateway: reconcile legacy/imported `agent.created` births missing resource and principal access events at boot, preserving the named owner and deterministic grants without allowing follow-up agent events to claim resources.
- Gateway: limit legacy agent-access repair to the owner-capped Space grant; defer home-folder grants to the agents module, preserve historical grant revocations, and fail boot on a conflicting deterministic repair event id.
- Gateway: include revoked grants in boot reconciliation history, preserve any existing agent Space grant without widening it, and validate every deterministic repair-envelope field, including `span_id`, on duplicate ids.
- Gateway: only `agent.created` may register an agent access resource, preventing concurrent host follow-up events from assigning it to `svc_host`.
- CI: run affected perf coverage in a serialized, dedicated workflow so push checks do not time out waiting on the shared perf-host disk lock.
- CI: gate pull requests and merge-queue batches on the serialized affected-perf result; a missing or failed affected perf shard cannot merge.
- Add consent-gated, idempotent Codex and Claude Code session import with immutable provenance, project identity binding, and linked live-chat continuation.
- Scope session sources, imported conversations, and project bindings to their owner and Space; default imports to Personal and require explicit confirmed Team destination selection.
- Resolve every session-import destination to an authorized concrete Space before writing; Personal defaults cannot land in an ambient Team, confirmed Team imports name their target, and continuation follows that target.
- Wire destination resolution and routed invocation through the real host context, preserving the authenticated principal, acting-for identity, and trace across the destination boundary.
- Add the platform-owned two-daemon destination provider: it resolves an owner’s Personal endpoint, validates Team membership at the target, and re-enters that daemon with the original invocation seed.
- Scope the v1 release candidate to Personal Space session import only; Team routing is explicitly deferred to v1.1.
- Desktop: consume successful one-time pair and join routes before later sign-out, keep sessions address-scoped, defer personal-key unlock until session verification, and restrict Space traffic to HTTPS except local loopback development endpoints.
- Desktop: redeem pair links and accept invite links through the real anonymous contracts, seal new Space keys to the previewed public Space id, and persist only after authenticated Space-ID agreement; paired-device key ciphertext stays out of ordinary session storage.
- Members: expose the invite preview's public Space routing id to pending and anonymous callers without exposing the one-time code.
- Desktop: route typed bootstrap and live deep links into the existing Connect, Sign in, and Join flows; packaged `tauri://localhost` now shows Connect a Space instead of posing as a Space.
- Desktop: make the native deep-link activation handoff atomic and keep one page-lifetime bridge subscription that buffers links between consumer callbacks.
- Desktop: retain deep links delivered while bootstrap drains the native pending-link slot, so page subscription cannot miss them.
- Desktop: expose typed bootstrap status and validated Vyre deep links through the narrow Tauri bridge, including second-instance launches.
- Desktop: stop the local sidecar through its loopback admin endpoint before process fallback, so Windows removes `vyred.json` on a requested shutdown.
- Desktop smoke: use Windows Ctrl-Break for graceful sidecar shutdown, preserving the cleanup and restart proof before bounded force cleanup.
- Desktop smoke: apply the owner-only mode-bit check only on POSIX hosts while retaining cross-platform token persistence coverage.
- Desktop smoke: bound Windows sidecar shutdown and prevent failed heavy tests from hanging CI.
- Desktop CI: bound packaged-shell readiness and guarantee Windows process cleanup on exit.
- CI: replace the desktop placeholder with blocking macOS and Windows packaging, Rust tests, policy checks, packaged-shell smoke coverage, and captured proof artifacts.
- Release: set the root package version to the intended `1.0.0-rc.1` candidate tag.
- Gateway: generate contract-valid, revocable ids for an agent's Space and home grants.
- Access: resolve gateway actor-kind home grants to their registered agent or person principal during projection.
- Computer home mirrors now invoke agent file operations on behalf of the agent's current owner.
- Scheduler: await the initial immediate repair tick before reporting the daemon started.
- Fix: keep the missing-item fallback snapshot stable so Mail and Automations do not enter a production React render loop before an item is selected; reset place failures on route changes.
- Agents: include deterministic idempotency keys in the `access.share` inputs as required by the capability contract.
- Auth: discover a Space name and display marker through anonymous `identity.sign_in_options`, enforce authenticated Space-ID continuity before storing or reopening a session, hide unsupported SSO/GitHub actions, and retain other Space sessions after a 401.
- Auth: brought the 0.6.8 account-form language into v1 with local password visibility, actionable account guidance, separated SSO and GitHub choices, and 44px-or-larger touch rows.
- Auth: expanded compact auth controls to 44px hit targets, omitted empty SSO sections, and made unavailable username suggestions truthful.
- Auth: added a bounded, motion-aware halftone field for the welcome and onboarding surfaces; it stays calm behind credential forms and never enters the signed-in shell.
- Auth: added the 0.6.8-style Welcome back / Connect a Space screen, HTTPS Space address normalization, and verified asynchronous handoff into existing credentials.
- Contracts: manifest types and builder DSL (packages/contracts), frozen declarations for the 72 modules plus 4 connectors and 4 Kits (manifests/), vyre-gen generator (tools/gen) with drift check, typecheck and generated contract tests.
- CI skeleton: affected-only selector, per-file capped test runner, pass cache by import closure hash, push/main/release/spike workflows.
- Repo bootstrap: npm workspaces scripts (gen, check, perf, golden, release), strict tsconfig.base.json (erasableSyntaxOnly, allowImportingTsExtensions, noEmit), Apache-2.0 LICENSE and NOTICE, CODEOWNERS for frozen paths, scripts/lanes.json (17 lane rows, 72 module owners, frozen paths), scripts/allowlist.json (initial third-party list), scripts/boundaries.json (layers, B1..B8 and exceptions).
- Apps: restore Forms, Campaigns, Templates and sending domains with reloadable detail/create routes, Personal gating before subscriptions, typed editors, preview-confirm publishing/launch/install, offline and permission errors, and real Kit builder chats. Preserve saved form consent, captcha, thank-you text and page grouping through an expanded read contract. Connect campaign email designs to saved versions, shared blocks, AI proposals and test sends; sandbox HTML previews and confirm send/save status only after the provider succeeds.

- Apps on phone web: add Apps under You and retain its create/detail route through the phone navigation history, so opening a form or campaign mounts its real editor at phone width.

- Apps Form editor: retain the desktop Apps sidebar, show compact field modes beside a live sandboxed canvas, and adapt Build/Code/Preview to phone width with one header. Persist custom CSS through the form read/write contract and open Ask with the actual assistant and form context.
- Apps Forms: add schema-aware preview controls and authenticated relation choices, theme/font/cover controls, conditional show/hide/require editing, local preview answers, question ordering and page preview. Preserve existing combined rules and theme keys; document the published renderer's remaining schema-widget gap against the v1 spec.
- Public forms: render selected schema fields with typed choice, boolean, numeric, date/time, survey and file controls; validate and coerce anonymous answers before record writes. Refuse arbitrary relation IDs, preserve signed-link bound values, and block publication of required relation questions pending explicit approved choices. Fix public file upload idempotency and typed file persistence; require folder write authority at configuration and recheck saved publisher authority, revocation and live local folder before accepting or consuming uploads.
