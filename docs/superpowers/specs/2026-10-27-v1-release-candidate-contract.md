# Vyre v1 Release Candidate Contract

**Date:** 27 October 2026  
**Owner:** Irfad Imtiaz  
**Release lead:** Simba  
**Baseline:** `main` at `2fc1392e`  
**Visual authority:** `/Users/irfad/Downloads/Vyre-v1-prototype.html`, SHA-256 `27e7e776127127d341273e6dc3bf6b624610938fd24cd58b42be350610626f72`

## Outcome

Ship a signed Vyre v1 release candidate that Irfad can install and use as his primary build. It must feel like one finished product, not a collection of completed tickets. Every in-scope screen must match the prototype's hierarchy, density, states, and visual direction while using real product data and behavior.

The release candidate targets:

- the signed macOS desktop app;
- desktop web;
- mobile web on iPhone, including Add to Home Screen behavior.

An Android APK and native iPhone app are later releases.

## Scope authority

This contract reconciles the prototype, `docs/spec/V1-SPEC.md`, `docs/spec/ARCHITECTURE-V1.md`, tracker rulings through ruling 99, and the handover dated 27 October 2026. When older documents conflict, the newest explicit owner ruling wins.

### Included in v1

- Home, Chats, Inbox, Records, Files, Apps, Automations, Vault, Settings, Console, and Join.
- All pages and meaningful states for those places shown in the prototype, including the complete Settings and Console hierarchies.
- Forms and Campaigns where the prototype or v1 specifications expose them as product capabilities.
- Agents, agent ownership and reassignment, agent computers, browser/Chrome work, and the human handoff paths required by the in-scope golden flows.
- Mail, calendar, calling, GitHub, Google, Microsoft, and mounted-storage integrations already designated for v1.
- Projects, journeys, tasks, gates, memory, sealed fields, backup, restore, recovery, offline states, and error states designated for v1.
- Local session import for Codex and Claude Code on macOS. Vyre detects supported local histories, previews them before import, groups them by normalized working directory or repository identity, creates or reuses real Vyre Project records, and attaches imported sessions to those projects with source provenance.
- The fourteen golden flows remaining after the latest owner scope ruling.
- Fresh-account and fresh-daemon behavior. A feature that works only with sample or seeded data is incomplete.

### Explicitly later than v1

- Sites and all `sites.*` capabilities, including the former sixth golden flow.
- Vault import.
- Native Android and iPhone applications, including native-phone proof.
- Voice capabilities.
- Mac or Windows desktop-control capabilities outside the scoped agent-computer/browser work.
- Vault breach monitoring and passkey sign-in.

Deferral of live proof against an unavailable external tenant does not permit a fake integration. The release may label such proof as owner-dependent only when the implementation, contract tests, fixtures, failure handling, and credential boundary are complete.

### Codex and Claude Code session import

Import starts in the person's Personal Space. Vyre must never place local history into a Team Space without an explicit destination choice and confirmation. A person may later use the normal Vyre copy, share, or project-membership flows to move selected work into a Team Space.

The importer must:

- discover supported Codex and Claude Code stores without reading transcript bodies until the person opens the preview and consents;
- show source, project guess, session count, date range, and destination before writing;
- derive project identity from repository metadata and normalized working-directory paths, then create or reuse the corresponding Project record in Vyre's existing Projects structure;
- import each session as a provenance-marked conversation linked to its Project, representing Codex or Claude Code as an outside actor rather than impersonating the person or creating a Vyre agent;
- copy the selected transcript and durable metadata into Vyre so the history survives source cleanup, while retaining the source identifier for deduplication and incremental re-import;
- never copy credentials, environment values, tool secrets, ignored secret files, or unrelated working-tree contents;
- remain idempotent across rescans, detect changed or appended sessions, and show conflicts instead of silently duplicating or overwriting user edits;
- handle missing, corrupt, partially written, and version-changed source files without aborting the rest of the import;
- support disconnecting the source without deleting imported Vyre data and deleting an import through normal project and conversation retention rules.

The release evidence must include redacted fixtures for both providers, first import, repeated import, incremental import, project deduplication, Personal Space isolation, explicit Team Space destination, corrupted input, and secret-redaction tests.

## Product and visual standard

The prototype is the visual contract. Shipped screens must preserve its information architecture, layout rhythm, typography, color system, navigation model, component language, responsive intent, and state transitions. The implementation may change details only where accessibility, platform conventions, real data, or a newer product ruling requires it.

Acceptance requires:

- every shipped route opens without a crash or render loop;
- no placeholder pages, dead primary actions, fake success states, or sample-only workflows;
- loading, empty, permission-denied, disconnected, offline, validation, and recoverable-error states where the workflow can enter them;
- keyboard access and visible focus for primary desktop workflows;
- usable touch targets, safe-area handling, viewport behavior, and installable-web behavior on iPhone;
- consistent shared components instead of one-off screen styling;
- screenshot review against the prototype at representative desktop and phone widths.

## Release-candidate gates

The build is an RC only when all of these are true:

1. All fourteen in-scope golden flows pass against the real application.
2. Every in-scope place and nested page opens on a fresh, unseeded account and daemon.
3. The complete main check suite passes at the exact release commit.
4. macOS ad-hoc signing, packaging, installation, first launch, and relaunch pass. Notarization is not an RC gate because no Apple Developer signing identity exists; the handoff must state the resulting Gatekeeper behavior plainly.
5. Desktop web and iPhone Add to Home Screen pass smoke tests, including login, navigation, safe areas, and persistence.
6. Backup and restore pass with user-created data.
7. Security checks pass with no committed credentials, privilege regression, or release-blocking finding.
8. The visual audit finds no release-blocking divergence from the prototype.
9. Release notes, version metadata, rollback instructions, and the runbook match the artifact.
10. GitHub produces the signed artifact from the protected release environment. Simba may approve that environment on Irfad's behalf for this release.

Warnings may remain only when they have a named owner, documented impact, and no effect on data integrity, security, installation, or the fourteen golden flows.

## Execution model

Work proceeds in parallel with one integration lead and three bounded lanes:

- **Integration and release:** repair the landing path, sequence dependencies, protect `main`, run the full gate, approve the release environment, sign, notarize, and publish the candidate.
- **Core behavior:** land the agent grant fix, rebase the Files mirror work, and close backend or integration failures that block golden flows.
- **Application stability:** diagnose and fix Mail and Automations render loops, then audit all routes and application states on fresh data.
- **Product finish:** compare the live product with every in-scope prototype screen, close visual and responsive gaps, and validate desktop and iPhone web behavior.

Agents work in isolated worktrees and commit only their assigned paths. The integration lead reviews each change, requires focused tests, then lands it through the repository's protected path. No agent weakens a test, branch rule, authorization boundary, or acceptance criterion to make a gate pass.

## Timeboxes and reporting

The first integration checkpoint occurs after 90 minutes. At that point Simba reports working surfaces, landed fixes, failing gates, and a revised RC time based on evidence.

The target is:

- an owner-usable integrated build in 3 to 4 hours;
- a signed release candidate in 6 to 8 hours.

These are execution targets, not permission to cut scope. A newly discovered data-loss, security, signing, or architecture defect stops the RC and receives an explicit impact report.

## Owner input

No further product decision is required to begin. Irfad's only optional input before the RC is a short use pass on the integrated build. Simba owns GitHub release-environment approval, integration decisions within this contract, and the final evidence package.

## Evidence package

The RC handoff includes:

- exact commit and version;
- signed artifact and checksums;
- CI and golden-flow results;
- route and prototype-coverage ledger;
- desktop and iPhone screenshots for critical paths;
- install, update, backup, restore, and rollback results;
- known non-blocking issues and explicit post-v1 scope.
