# Vyre v1 Release Candidate Implementation Plan

> **For Simba:** Execute this plan with `subagent-driven-development`. Use a fresh agent for each bounded implementation task, then a spec review and a code-quality review. Use Luna/low for mechanical work, Terra/medium for multi-file implementation, and the strongest model only for architecture or final integration judgment.

**Goal:** Produce an owner-usable, signed Vyre v1 RC matching the approved release contract, including local Codex and Claude Code session import.

**Architecture:** Preserve Vyre's capability, event, projection, replica, and shared-screen boundaries. Integrate existing packet branches through protected PRs, put new local-history discovery behind a desktop host seam, write imported data through typed capabilities, default it to Personal Space, and reuse Project and Chat resources. Build and verify on CI; do not run Node, npm, or repository scripts on the Mac checkout.

**Stack:** TypeScript 5, React 19, Expo web, Tauri 2/Rust, Vyre manifest/contracts/kernel/host/modules/client architecture, node:test, Playwright, GitHub Actions.

**Release contract:** `docs/superpowers/specs/2026-10-27-v1-release-candidate-contract.md`

---

## Task 1: Restore the protected landing path and land the agent-folder grant fix

**Worktree:** `/Users/irfad/Claude/Orgs/Vyre/v1-wt/P-L5_30`  
**Branch/PR:** `build/P-L5_30`, PR #717

**Files:**

- Modify: `modules/agents/handlers/crud.ts`
- Modify: `modules/agents/tests/owned.test.ts`
- Modify: `changelog.md`
- Repair outside git: the stopped landing script's missing ruleset payloads, after reading the live ruleset through GitHub first

**Steps:**

1. Add a focused regression assertion showing each `access.share` call contains its deterministic `idempotencyKey` in the capability input and call options.
2. Push the test-only commit and confirm the expected contract/lint failure in GitHub Actions.
3. Move the existing deterministic keys into the input objects while retaining the call options.
4. Update `changelog.md` with the grant/bootstrap correction.
5. Push, wait for all required #717 checks, and inspect failures rather than rerunning blindly.
6. Reconstruct the temporary ruleset restore payload from the live GitHub ruleset. Do not use stale or missing scratch files.
7. Merge #717 through the protected merge path only after required checks are green.

**Proof:** #717 required checks green; `modules/agents/tests/owned.test.ts` passes in CI; merge commit is on `main`; live ruleset remains enabled after landing.

## Task 2: Remove the production Mail and Automations render loops

**Worktree:** `/Users/irfad/Claude/Orgs/Vyre/v1-wt/P-APP_03`  
**Branch/PR:** `build/P-APP_03`, PR #517

**Files:**

- Modify tests first: `apps/app/tests/real-app.e2e.test.ts`
- Modify likely providers after diagnosis: `apps/app/src/shell/providers/inbox.tsx`, `apps/app/src/shell/providers/automations.tsx`, `apps/app/src/shell/providers/first-list.tsx`
- Modify only if the trace proves necessary: `apps/app/src/shell/session/remote-hooks.ts`, `apps/app/src/shell/session/PlaceHost.tsx`
- Modify: `changelog.md`

**Steps:**

1. Download the failed real-app artifact and browser console from Actions run `40407310718`.
2. Extend the real-app test so Mail and Automations each fail on the first React 185 error, with route and component stack recorded.
3. Push the test-only commit and confirm the expected failure.
4. Remove the unstable snapshot, provider value, query, or subscription dependency identified by the trace. Do not silence React errors or rely on the error boundary.
5. Add the correction to `changelog.md`.
6. Push and require both real-app and screenshot jobs to pass. Review fresh captures for blank/error-boundary screens.

**Proof:** Mail and Automations open in the production export with zero console errors, zero error-boundary renders, and stable repeated navigation.

## Task 3: Land the Files mirror after its access dependency

**Worktree:** `/Users/irfad/Claude/Orgs/Vyre/v1-wt/P-L2_35`  
**Branch/PR:** `build/P-L2_35`, PR #715

**Files:** Keep the branch's existing owned paths; resolve only conflicts introduced by current `main`; update `changelog.md` if the branch has not already done so.

**Steps:**

1. After #717 lands, merge current `origin/main` into `build/P-L2_35` without rewriting history.
2. Preserve ruling 98's Files mirror behavior and ruling 99's owner/agent grants.
3. Push and require the real computer, Files, access, and heavy checks selected by CI.
4. Inspect the agent computer artifact and verify `~/Vyre` exposes the intended folder once, with no second sync copy.
5. Merge through the protected path.

**Proof:** #715 required and heavy checks green; computer artifact shows the single mounted Files tree; merge is on `main`.

## Task 4: Add Codex and Claude Code discovery and parsing

**Branch:** `build/P-L10_session-import` in a new isolated worktree based on the latest green `main`.

**Files:**

- Create: `apps/desktop/src/session-import/types.ts`
- Create: `apps/desktop/src/session-import/discover.ts`
- Create: `apps/desktop/src/session-import/codex.ts`
- Create: `apps/desktop/src/session-import/claude.ts`
- Create: `apps/desktop/tests/session-import.test.ts`
- Create redacted fixtures under: `apps/desktop/tests/fixtures/session-import/`
- Modify: `apps/desktop/src-tauri/src/commands.rs`
- Modify: `apps/desktop/src/bridge.ts`
- Modify: `changelog.md`

**Steps:**

1. Finalize provider paths and field mappings from the research report. Fixtures must contain synthetic text only.
2. Write failing tests for discovery metadata without transcript reads, Codex parsing, Claude parsing, partial writes, corrupt lines, source version drift, path normalization, and secret redaction.
3. Push the test-only commit and confirm the affected CI failure.
4. Implement parsers as pure functions, then implement the narrow Tauri command that lists stores and reads only a user-selected source.
5. Return stable `provider`, `sourceSessionId`, `sourceProjectKey`, `workingDirectory`, timestamps, messages, and redaction warnings. Never return environment values or raw tool credentials.
6. Update `changelog.md`; push and require desktop TypeScript/Rust tests and security scans.

**Proof:** Synthetic Codex and Claude fixtures parse deterministically; discovery does not read transcript bodies; corrupt sessions are isolated; secret fixtures are refused or redacted.

## Task 5: Import local sessions into Personal Space Projects and Chats

**Branch:** Continue `build/P-L10_session-import` after Task 4 passes spec and quality review.

**Files:**

- Create: `manifests/import-sessions.ts`
- Modify: `manifests/index.ts`
- Create: `modules/import/handlers/sessions.ts`
- Modify: `modules/import/index.ts`
- Create: `modules/import/tests/sessions.test.ts`
- Modify: `modules/projects/handlers/` only through an existing project create/reuse capability
- Modify: `modules/chat/handlers/` only through an existing conversation/message import capability, or add the smallest typed import capability if none exists
- Modify: `changelog.md`

**Steps:**

1. Write failing contract tests for Personal Space default, explicit Team Space confirmation, outside-actor provenance, project create/reuse, first import, repeat import, appended-session import, conflicting edits, disconnect, and delete/retention behavior.
2. Push the test-only commit and confirm the intended CI failures.
3. Add typed capabilities and events for preview, import, rescan, and source disconnect.
4. Deduplicate by provider plus source session ID; store an append checkpoint and content hashes. Reuse projects by provider-independent repository identity when available, otherwise normalized working directory.
5. Create Codex and Claude Code as outside actors. Do not create Vyre agents or impersonate the person.
6. Copy selected transcript content into Vyre and link the conversation to the Project. Do not copy repositories or secret-bearing tool payloads.
7. Update `changelog.md`; regenerate derived files through the bot/CI path; push and require contracts, boundaries, authorization, and restricted-export tests.

**Proof:** Re-import adds no duplicate project or messages; an appended source adds only new messages; Personal Space data never appears in a Team Space without explicit confirmation; backup/export obeys retention and privacy rules.

## Task 6: Build the import preview and placement experience

**Branch:** Continue `build/P-L10_session-import` after Task 5 passes spec and quality review.

**Files:**

- Create: `apps/app/src/places/settings/import/SessionImport.tsx`
- Create: `apps/app/src/places/settings/import/session-import.test.tsx`
- Modify: `apps/app/src/places/settings/` route/registry mapping for the existing Import screen
- Modify: `apps/app/src/join/Checklist.tsx`
- Modify: `apps/app/src/shell/session/PhoneHost.tsx` to show a desktop-required explanation, not local discovery
- Add screenshot target and mount under: `scripts/shots/targets/` and `scripts/shots/mounts/`
- Modify: `changelog.md`

**Steps:**

1. Write failing screen tests for detected-source summary, consent before body reads, project mapping edits, Personal Space default, explicit Team Space warning, progress, partial failure, repeat scan, and completion links.
2. Push the test-only commit and confirm the selected UI tests fail.
3. Implement the prototype-consistent settings/import flow using shared rows, sheets, progress, and quiet inline feedback.
4. Add the optional first-run checklist entry without blocking users who have neither tool installed.
5. On web or phone, explain that local discovery runs from the Mac app; allow viewing already imported projects and conversations normally.
6. Capture desktop and phone-width screenshots; update `changelog.md`; push.

**Proof:** A user can preview, correct mappings, import, and open the created Project and conversations; no source transcript body is read before consent; phone layout remains usable.

## Task 7: Make the macOS desktop artifact a real release output

**Branch:** `build/P-L11_desktop-release` from latest green `main`.

**Files:**

- Replace: `.github/workflows/desktop.yml` using the proven structure in `apps/desktop/src-tauri/ci/desktop.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/release/pack.ts`
- Modify: `scripts/release/release.test.ts`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `docs/release/runbook.md`
- Modify: `changelog.md`

**Steps:**

1. Write failing workflow/release tests requiring a macOS Tauri build, signed `.app`/DMG artifact, checksum, and release attachment.
2. Push the tests and confirm the expected CI failure.
3. Replace the placeholder workflow with the already prepared macOS build steps. Windows remains non-blocking and Android/iPhone native stay out of scope.
4. Make macOS a blocking RC artifact. Use ad-hoc signing if no Developer ID/notarization credential exists; use Developer ID and notarization when the protected environment exposes valid Apple credentials. State the resulting trust level in release notes.
5. Attach the Mac artifact and checksum to the GitHub prerelease and include it in signed release metadata.
6. Correct the stale release runbook using the live environment, signing runner, and secret names without exposing values.
7. Update `changelog.md`; push; run desktop workflow on the branch and inspect launch screenshot/artifact.

**Proof:** GitHub builds a Mac artifact from the RC commit, verifies its signature, launches it against its sidecar, captures the shell, and carries it into release metadata.

## Task 8: Verify desktop web and iPhone Add to Home Screen

**Branch:** `build/P-APP_web-install` from latest green `main`.

**Files:**

- Modify if required: `apps/app/app/+html.tsx`
- Modify if required: `apps/app/src/startup/boot.ts`
- Modify if required: `apps/app/app.json`
- Create or modify: production-web install tests under `apps/app/tests/`
- Add screenshots/probes under: `scripts/shots/`
- Modify: `changelog.md`

**Steps:**

1. Write failing production-export tests for web manifest, icons, standalone mode, service-worker update behavior, viewport/safe areas, login persistence, and offline relaunch.
2. Push and observe the intended failures.
3. Implement only missing installability or safe-area behavior.
4. Run real-app capture at desktop and iPhone viewport widths. Assert no horizontal clipping and usable primary navigation/touch targets.
5. Update `changelog.md`; push and merge after checks and screenshots pass.

**Proof:** Production export installs to iPhone Home Screen, launches standalone, preserves session and navigation, and recovers after offline/reconnect.

## Task 9: Close the v1 conformance and prototype ledger

**Branch:** One bounded branch per independent gap, never one sweeping branch.

**Files:**

- Update evidence: `docs/spec/conformance.md`
- Create: `docs/release/v1-route-ledger.md`
- Update screenshot targets: `scripts/shots/targets/*.json`
- Change only the owning module/place files for each confirmed in-scope gap
- Modify `changelog.md` in every code branch

**Steps:**

1. Re-run the conformance audit against current `main`; mark stale observations separately from real gaps.
2. Inventory every prototype page/state and map it to a real route, component, typed capability, test, and screenshot target.
3. Exclude only the contract's explicit post-v1 items.
4. Land already-green PRs before writing duplicate code. For red or conflicted PRs, diagnose and repair the existing branch when ownership is clear.
5. Split remaining gaps by owner path. Each behavior change follows test-only failing push, minimal implementation, CI proof, spec review, and quality review.
6. Re-run real-app shots on a fresh, unseeded daemon. Reject placeholders, dead actions, seed-only paths, blank screens, and error boundaries.

**Proof:** Every in-scope ledger row has a route, implementation, automated test, and current screenshot or an explicit non-visual proof. No row remains `missing`, `built and untested`, or `placeholder` for in-scope v1.

## Task 10: Full release gate, signed RC, and owner handoff

**Branch:** Exact release commit on protected `main`.

**Files:**

- Modify: package and app version files through `scripts/release/cli.ts bump`
- Modify: `docs/release/runbook.md`, `docs/release/v1-route-ledger.md`, release notes, `changelog.md`
- Update session records in the Simba memory files after evidence is final

**Steps:**

1. Dispatch the full `check`, golden, contracts, shots, heavy, security, perf, Mac install, desktop, backup/restore, and release dry-run workflows on the exact commit.
2. Require all fourteen in-scope golden flows to execute without todo/skip placeholders.
3. Complete a fresh Personal Space install and a Team Space join, then create user data, back it up, restore it, and compare counts/hashes.
4. Fix any missing `buildx` runner label before tagging; verify the label through the GitHub API.
5. Bump to `1.0.0-rc.1`, merge the version PR, and tag that exact `main` commit.
6. When the protected `release` deployment waits, inspect its environment and commit, then approve it through GitHub using Irfad's authorization.
7. Wait for package, sign, publish, deploy, and smoke. Download the release and verify checksums independently.
8. Publish the evidence package from the release contract, including the artifact's actual signing/notarization status and every non-blocking issue.
9. Remove temporary CI hosts only after the RC evidence has been retained.

**Proof:** The GitHub prerelease contains the exact RC commit's signed manifests, server/web/Kits/Chrome outputs, Mac artifact, checksums, and passing post-publish smoke. The owner handoff links every gate result and install instruction.
