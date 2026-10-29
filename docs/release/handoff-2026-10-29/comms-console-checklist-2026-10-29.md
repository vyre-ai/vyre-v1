# Comms Console four-item completion checklist

Started 29 October 2026, 03:05 PKT. Agent `/root/auth068_completion` now owns Comms only after auth handoff. Isolated reused checkout `/Users/irfad/Claude/Orgs/Vyre/v1-wt/rc1-auth068-completion`, branch `codex/rc1-comms-completion`, base d2573b3a (fast-forwarded from 8216762c). Root owns Integrations. No more agents.

| Fixed section | Current defects | Planned completion | Acceptance |
|---|---|---|---|
| 1 Domains | Raw provider enum field; flat list/form; stale selected object after refresh | Shared ObjectList and ObjectPage, typed Resend/Mailgun picker, real add/check/default/remove, readable DNS values, explicit destructive impact | Actual gateway readback/reload; provider errors stay errors; desktop/phone captures |
| 2 Numbers | Raw recipient IDs; buying omits required assigneeId; no assignment/route/hours editor; recording only toggles two of three values | Named person/agent/shared-inbox assignees; named person/agent/group ring targets; 5–120 second ring interval; voicemail/transcription toggles; weekly hours/timezone/outside-hours editor; all recording choices; buy/release review | Actual local route/hours/recording/assignment persist/readback/reload on explicit fixture number; no live paid purchase during testing |
| 3 Shared inboxes | Raw privacy enum; raw domain IDs in routes; no title/route/pause/disconnect editing | Typed privacy; canonical named access.share controls for selected people; named domain route setup/remove; title and supported lifecycle actions; ObjectPage tabs | Actual mailbox create/privacy/title/route/access readback; named recipients; no secret fields or invented members API |
| 4 Texting | Saved draft never hydrates inputs; incomplete required submit details; missing submit idempotencyKey | Hydrated complete registration editor including business address/contact/opt-in/sample messages; typed country; validation; existing draft/rejected edit rules; reviewed submit/refresh | Actual save/readback/reload, incomplete submit stays disabled, provider submission error stays truthful; no actual provider filing during acceptance |

## Existing contracts and boundaries

- No backend protocol additions planned. `mail.domain.*`, `mail.mailbox.*`, `mail.route.set/remove`, `telephony.number.assign/set_route/set_hours/set_recording`, and `telephony.registration.*` cover the requested controls.
- Mailbox privacy setter does not carry a recipients array. Named people use existing `access.share`, `access.shares_of`, `access.unshare` on the `mailbox` resource. Privacy affects newly arriving mail; old mail keeps its original visibility.
- A number has no title rename capability. Its existing title is displayed; purchase accepts a title. Do not invent an update command or imply a rename persisted.
- Number assignment requires an actual recipient id even for a shared inbox; current Buy button is invalid because it omits this. Number route recipients support person/agent/group, while assignment supports person/agent/inbox.
- Texting submit requires a stable attempt idempotency key and complete address/contact/sample inputs. Registration is immutable while submitted/in review/approved.
- Resend/Mailgun/Twilio depend on configured provider credentials and external services. UI must surface actual errors. Tests may seed explicit local fixture objects for pure configuration edits; do not claim a real number purchase, DNS verification, mail delivery or carrier registration from a fixture.
- Root authorized exactly three dispatcher callsite props: initialId from domainId/numberId/mailboxId in `shell/providers/console.tsx`. Other dispatcher callsites, shared.tsx, ObjectList, and Integrations remain outside this lane.
- Dependency: scope agent is fixing principal.created display-name propagation so newly invited people have names in access.principals.list/get. Until available, use existing identity-name helpers; never display ids as fallback.

## Implementation sequence

1. Add local typed form/model helpers and meaningful contract tests for hours validation, recipient mapping and registration hydration/readiness.
2. Convert lists/objects and Domains/Texting first; preserve existing API boundaries and draft values across reads.
3. Complete Numbers routing/hours/assignment and shared Inbox routes/access/lifecycle controls.
4. Run focused tests, changed-source semantic checks, lint/secrets, then one serialized Expo export and actual gateway/browser readback + reload captures. Report DONE/PARTIAL/MISSING separately for function, primary browser and visual acceptance every 15 minutes.


## Verified implementation checkpoint, 29 October 03:48 PKT

- Function: 4/4 supported page controllers implemented. Primary browser: 4/4 actual fresh-daemon persistence flows passed, with normal access checks. Visual: 4/4 have real light desktop, dark desktop and 390px phone captures, with no horizontal overflow. Capture directory: `/Users/irfad/Downloads/Vyre-v1-RC-screens/comms-console`.
- Domains: existing provider DNS values appear before Check DNS; typed provider selection; real default sender mutation/readback/reload. Add/check/remove retain real provider boundaries and explicit remove impact. No public DNS change claimed.
- Numbers: actual named inbox assignment and named group ring target, 30-second ringing, voicemail transcription change, weekly hours and ask-before-recording survived actual gateway readback/reload. Purchase/release show explicit consequences; acceptance never purchased a number or sent a message.
- Shared inboxes: actual create/title/privacy/canonical group access/domain route survived reload. Fixed a real list-scope defect: `scope:shared` excludes inboxes owned by the current person; `kind:shared, scope:all` now retains that person's newly created inbox in the Console and assignment picker. Browser regression verifies it remains in the list.
- Texting: all saved business/contact/address/opt-in/sample-message fields hydrate after reload. Reviewed submit has its required idempotency key and warns about carrier fees; acceptance opens review without filing with a carrier.
- Initial explicit module DB fixtures correctly failed authorization because they lacked canonical resource births. Final test-local helper stops its isolated daemon, appends canonical `resource.created` events for its fake pre-owned domain/number, then restarts the real daemon. Gateway authorization remains unchanged. No shared harness or production backend changes.
- Proof: `/tmp/vyre-comms-browser6.log` 8/8, including desktop/phone captures. `/tmp/vyre-comms-focused-final.log` three files green. `/tmp/vyre-comms-own-semantic-final.log` zero diagnostics for owned Comms sources; baseline transitive diagnostics are not claimed resolved. `/tmp/vyre-comms-lint-final.log` 15 changed files, zero findings. `/tmp/vyre-comms-secrets-final.log` 6572 tracked files, zero hits. `/tmp/vyre-comms-slow-final.log` slow-check OK.
- Exact source export after lint fixes: `/tmp/vyre-comms-web3`; final browser rerun log `/tmp/vyre-comms-browser-final.log`.
- Remaining bounded follow-up: primary domain/number/inbox lists currently request the first 100 rows; complete cursor pagination remains to add. External provider operations require live connected providers; fixture acceptance does not substitute for their acceptance. Parent still owns combined integration CI and packaged release proof.

## Visual proof correction, 29 October 04:01 PKT
Earlier emulateMedia-only captures still rendered Paper because the app skin stayed selected. Replaced those captures with explicit canonical ?skin=graphite/paper navigation and data-skin assertions. Exact full fresh-daemon Comms rerun8/8 green /tmp/vyre-comms-real-skins.log. Actual Graphite Number image was visually inspected and is dark. All four dark/phone images were regenerated in the same capture directory. This corrects the prior evidence label; no production UI changes.

## Cursor pagination gap closed, 29 October 04:08 PKT
Domains, Numbers and Shared inbox lists now expose canonical ObjectList Load more controls. Shared integration-data remains unchanged. Local Comms paging binds extra rows to first-page canonical IDs and ignores late results from changed snapshots; live births/removals rebase cursors. Canonical-ID deduplication prefers current first-page rows. Actual browser creates104 real inboxes alongside its existing shared inbox, loads105 distinct rows, inserts a real alphabetically-first inbox while mounted, reloads the cursor, and compares all106 unique displayed IDs with both actual gateway pages. No fake data or denied access bypass. /tmp/vyre-comms-pagination-browser.log; artifact /tmp/vyre-comms-paged-web. Focused2files, ownedstrict0 and lint4files0.
