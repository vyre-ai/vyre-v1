# Auth 0.6.8 completion checklist

Updated 29 October 2026, 02:34 PKT. Dedicated lane started 01:39 PKT; one-hour report due 02:37 PKT. Core slice committed as **97afdc98** on `codex/rc1-auth068-completion`, based on **65486a91**. Root lead owns integration. Existing Welcome c1c5750d and forms 24ec9437 preserved.

| Fixed item | Function | Actual browser proof | Visual acceptance |
|---|---|---|---|
| 1 Welcome/address | DONE for existing address and Get started choices | Fresh production Welcome, address-neutral startup and Back | Captured light; existing shared 0.6.8 kit |
| 2 Password login | DONE existing contract; no new protocol | Real wrong-password retry and successful owner/member sign-in via Unlock | Unlock light, dark and phone inspected |
| 3 Second factor | Existing implementation, PARTIAL acceptance | Existing focused tests preserved; new real second-factor fixture not yet run | Shared kit; dedicated real capture remains |
| 4 Signup/owner claim | DONE existing canonical claim path | New Team setup choice accepts actual fresh daemon owner link, account and recovery confirmation enter shell | Real light/dark/phone signup captures; recovery code masked |
| 5 Invited account signup | DONE web canonical route | Actual new Member signup from generated invite; owner API verifies web device; no mocked success | Real invite light/dark/phone, name/account/AI frames |
| 6 Lock/unlock | DONE current identity session | Clears all local bearer cache, current bearer returns 401, reload stays locked, wrong password refuses, correct password enters app | Shared 0.6.8 kit, desktop and phone captures |
| 7 Add a Space | DONE supported connect/join/claim entry | Desktop switcher and phone You both open chooser; Back restores existing Space | Phone overlap caught and fixed; current phone capture inspected |
| 8 Create Personal Space | DONE source/process; packaged app acceptance PENDING | Real native launch spec creates personal-kind profile, stable UUID/restart/no-overwrite; real account claim/reuse/reload passes in browser with IPC transport fixture | Actual Personal owner claim capture; dedicated native create light/dark captures pending |
| 9 Create Team Space | PARTIAL provision/handoff boundary | Actual Linux installer command + real owner-claim handoff; no invented remote provisioning | Setup frame captured; deployment remains owner infrastructure |
| 10 GitHub return | MISSING OAuth start contract | Existing sign-in endpoint accepts provider code, but no start/state/callback path; production button remains hidden | No fake enabled button |
| 11 Back/history/retry/errors | DONE tested core paths; PARTIAL wider history | Invalid invite retry then chooser/Back restores existing Member; spent invite cleared before shell navigation | Error panel shares auth kit; phone capture |
| 12 Light/dark/phone/keyboard | PARTIAL full matrix | Phone width fit assertions on invite/Unlock/chooser; Escape implemented; exhaustive keyboard/TOTP matrix remains | Actual screenshots inspected: Unlock light, invite dark phone, signup dark, chooser phone. Every frame not yet independently accepted |

## Exact verification

- Production export: `/tmp/vyre-auth068-proof-web`, serialized via `/tmp/vyre-serial-export.py`, Node 24. Dependency tree APFS-cloned from root integration; workspace package resolution points to this isolated checkout. No npm install.
- `apps/app/tests/auth.entry.live.test.ts`: **10 tests passed, 0 failed, 0 skipped**, 16.5 seconds. Seven real browser lifecycles plus two harness tests and parent test. Log `/tmp/vyre-auth068-proof-browser.log`.
- Seven focused files passed: JoinFlow, entry screens, entry parser/history, session bootstrap/invite, phone, rail switcher, owner claim. Log `/tmp/vyre-auth068-proof-focused.log`.
- Lint: 21 changed files, zero findings. Secret scan: 6514 files, zero hits. `git diff --check` clean.
- Pinned TS5.9.2 changed SessionGate/SpaceEntry/entry/browser files have no diagnostics; transitive baseline strict/exact-optional diagnostics remain. No claim that the entire repository typecheck passes.
- Real captures: `/Users/irfad/Downloads/Vyre-v1-RC-screens/auth-entry-completion/`. Earlier `failure.png` and `failure.txt` are stale debugging artifacts and are not acceptance evidence.

## Next bounded work

Inspect Tauri managed device sidecar and canonical daemon fresh-claim flow for a real native Personal creation bridge. Root has explicitly required automatic Personal creation; manual Terminal instructions are not accepted as completion. Proposed bridge must accept no arbitrary shell/path, use a fixed local profile and loopback endpoint, preserve the existing device daemon and reuse the canonical owner-claim UI.

## One-hour handoff update, 02:34 PKT

Commits delivered: core **97afdc98**, packaged-origin CORS **5043ddce**, native Personal **3cf0832080c6c6b21e3ea9842acca81cd3ad3434**. Root has integrated core auth; root review owns remaining integration.

Fixed 12-item source status: **8 DONE at source/core process level**, three PARTIAL acceptance/provision boundaries (second factor real fixture, Team infrastructure setup, complete visual/keyboard matrix), one MISSING contract (GitHub OAuth start). Personal DONE does not mean packaged app IPC/DMG proof has passed. New recipient admin-reset UI gap is tracked under password/signup acceptance and remains next work, not silently considered done.

- Exact latest export `/tmp/vyre-personal-gated-web`: **13/13 browser tests passed**, including original core 10 and Personal 3. Personal uses actual fresh Personal daemon, actual crypto/key/account creation, actual `spaces.get kind=personal`, unavailable startup retry, claimed profile reopen and reload. Only native IPC transport is a fixture. Logs `/tmp/vyre-personal-gated-browser.log`, `/tmp/vyre-personal-resume-browser.log`.
- **30/30 native unit tests passed**, one integration test intentionally ignored by default. Log `/tmp/vyre-personal-native-unit-final.log`.
- That integration test was also explicitly invoked: **1/1 actual canonical daemon process test passed**, using the exact same fixed launch argument generator as Tauri. It proves actual Personal kind, stable identity, authenticated graceful stop with exit 0, restart with same identity and preservation of existing user file. Log `/tmp/vyre-personal-native-process-proof4.log`. It uses verified Node24/source daemon; the small Cargo compile-fixture binary is not counted as a production bundled binary.
- **4/4 real daemon CORS tests passed**: exact packaged origins only, preflight, authenticated read, anonymous private request still refused, malicious variants no CORS. `/tmp/vyre-personal-cors-tests.log`.
- Seven focused files pass; latest lint 20 files/zero findings; secret scan 6519 files/zero hits. Existing transitive TS diagnostics remain; own changed auth/bridge source had zero diagnostics.
- Runtime issues actually found and fixed: missing initial Space ID on native fresh creation, stale browser invite replay, phone chooser text overlap, missing cross-origin preflight, and CLI HTTP-stop leaving top-level await unsettled.
- Actual native claim screenshot: `/Users/irfad/Downloads/Vyre-v1-RC-screens/auth-entry-completion/personal-native-claim.png`; earlier listed real captures preserved.

Next: recipient reset form uses existing anonymous `identity.reset_complete`, generates fresh keys on device, acknowledges private-data loss, persists only verified signed-in response. No new recovery-fetch or OAuth protocol is being invented. Full packaged app acceptance and visual matrix remain explicit release checks.
