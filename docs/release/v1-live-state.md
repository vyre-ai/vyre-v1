# Vyre v1 Live Continuation Checkpoint

**Update this file at each material integration change. Read it first after any context compaction, then read the current release contract and the canonical handover.**

## Lead continuity protocol

1. Remain in the lead thread until the release candidate is published.
2. Keep implementation in bounded background-agent lanes. The lead owns decisions, reviews, CI, merge queues, release approval, artifact evidence, and owner communication.
3. Never send a final response while a release-critical lane, CI failure, protected merge, release gate, or owner-visible decision remains open.
4. After compaction, do not restart discovery. Read this checkpoint, `docs/superpowers/specs/2026-10-27-v1-release-candidate-contract.md`, and `/Users/irfad/Claude/Orgs/Vyre/team/v1/HANDOVER-2026-10-27.md`, then inspect the named PRs and runs.
5. Report real artifacts and exact blockers. Do not describe a lane as complete until its required CI and review gates pass.

## Current state: 27 October 2026 PKT

- **Merged:** PR #517 fixed the real-app Mail/Automations React #185 navigation loop. Full CI and production-export screenshot capture passed.
- **Merged PR #721:** atomic agent-home grants, reassignment correction, and scheduler readiness landed on `main` as `3d8ef650`. Fresh CI and independent review passed. GitHub does not allow the author to approve their own PR; owner authorized the compliant reviewed admin merge rather than a branch-protection mutation. Advance dependent #715 from this mainline.
- **Merged PR #715:** Files mirror landed as `465d6423` after rebasing from #721 and passing full CI/review. Mirror invokes now resolve the agent's live owner on every pass, use the owner ID as `actingFor`, and have focused reassign/missing-owner regression coverage.
- **Merged PR #722:** the first combined integration run exposed a real agent-home authorization defect: actor-wire grants for registered agents and people were not folded back to their registered principal kinds. `2da1630d` resolves only existing registered principals, preserves true outside actors, and keeps kernel snapshot grants in their intentional generic `actor` wire form. Full CI and independent code review passed before the reviewed admin merge.
- **PR #719:** replaces desktop CI placeholder with blocking macOS and Windows package builds, ad-hoc Mac signing proof, shell smoke, and artifacts. Windows exposed a real smoke-script defect: a failed sidecar-state assertion was swallowed and teardown could hang. Head `249b9f22` preserves the persistence proof, propagates its actual test exit code, and bounds Windows cleanup. Full matrix, including Windows packaged-shell smoke, passed in run `40423475790`; the branch is now being normally merged with current `main` for one final integration run.
- **Session discovery branch:** `build/P-L10_session-import`, native Codex and Claude metadata discovery is green in run `40417505140`. It uses immutable-only Codex SQLite and native bridge discovery for both providers.
- **Session import capability:** PR #720 has the typed `sessions.import`/`sessions.continue` slice, consent, immutable provenance, mapping/fallback, incremental conflicts, and owner/source isolation. RC behavior is deliberately **Personal Space only**: import and continuation target the current Personal Space, while Team destinations are explicitly refused. The dead cross-Space router has been removed at `47a3eb1e`; its fresh regen/security checks are green and its full check is pending. Proper Team routing requires a future authenticated directory plus capability-invocation transport and two-daemon proof; it is v1.1 work, not a silent v1 fallback.
- **Desktop CI:** PR #719's macOS build, ad-hoc signature verification, packaged-shell smoke, and capture passed. Windows has built and is in packaged-shell smoke.
- **Session discovery security remediation:** `a06d81e9` percent-encodes immutable SQLite paths and redacts Git remote userinfo before metadata crosses the bridge. Check and security workflows are in progress.
- **Release infrastructure:** buildx runners and the isolated release signing runner are online. No runner-label mutation is needed. Apple Developer identity is unavailable; RC uses ad-hoc Mac signing and must state its Gatekeeper behavior.

## Primary evidence locations

- Release contract: `docs/superpowers/specs/2026-10-27-v1-release-candidate-contract.md`
- Execution plan: `docs/superpowers/plans/2026-10-27-v1-release-candidate.md`
- Canonical handover: `/Users/irfad/Claude/Orgs/Vyre/team/v1/HANDOVER-2026-10-27.md`
- Current production-export captures: `/tmp/vyre-shots.LKFtVn/` and `/tmp/vyre-715-shots.yAQRMA/`
