# Vyre v1 Live Continuation Checkpoint

**Update this file at each material integration change. Read it first after any context compaction, then read the current release contract and the canonical handover.**

## Lead continuity protocol

1. Remain in the lead thread until the release candidate is published.
2. Keep implementation in bounded background-agent lanes. The lead owns decisions, reviews, CI, merge queues, release approval, artifact evidence, and owner communication.
3. Never send a final response while a release-critical lane, CI failure, protected merge, release gate, or owner-visible decision remains open.
4. After compaction, do not restart discovery. Read this checkpoint, `docs/superpowers/specs/2026-10-27-v1-release-candidate-contract.md`, and `/Users/irfad/Claude/Orgs/Vyre/team/v1/HANDOVER-2026-10-27.md`, then inspect the named PRs and runs.
5. Report real artifacts and exact blockers. Do not describe a lane as complete until its required CI and review gates pass.

## Current state — 27 October 2026 PKT

- **Merged:** PR #517 fixed the real-app Mail/Automations React #185 navigation loop. Full CI and production-export screenshot capture passed.
- **PR #717:** atomic agent-home grants. Current head `b987419b`; CI run `40417569736` is red. The lead is tracing the failed shards before another change. Do not merge until this run is green and fresh spec plus quality reviews approve.
- **PR #715:** Files mirror branch includes the merged #517 changes. Its earlier `l2-heavy` failure depends on #717; re-run and enqueue only after #717 lands.
- **PR #719:** replaces desktop CI placeholder with blocking macOS and Windows package builds, ad-hoc Mac signing proof, shell smoke, and artifacts. Run `40417003122` is still active; its ordinary PR suite currently sees the same agent-owner test family, which must be resolved through #717, not suppressed.
- **Session discovery branch:** `build/P-L10_session-import`, native Codex and Claude metadata discovery is green in run `40417505140`. It uses immutable-only Codex SQLite and native bridge discovery for both providers.
- **Session import capability:** active implementation lane. It must add typed `sessions.import` and `sessions.continue` capability/schema/projection support; existing Project/Chat capabilities cannot safely create immutable provenance-marked imported transcripts. Required behavior is defined in the release contract.
- **Release infrastructure:** buildx runners and the isolated release signing runner are online. No runner-label mutation is needed. Apple Developer identity is unavailable; RC uses ad-hoc Mac signing and must state its Gatekeeper behavior.

## Primary evidence locations

- Release contract: `docs/superpowers/specs/2026-10-27-v1-release-candidate-contract.md`
- Execution plan: `docs/superpowers/plans/2026-10-27-v1-release-candidate.md`
- Canonical handover: `/Users/irfad/Claude/Orgs/Vyre/team/v1/HANDOVER-2026-10-27.md`
- Current production-export captures: `/tmp/vyre-shots.LKFtVn/` and `/tmp/vyre-715-shots.yAQRMA/`
