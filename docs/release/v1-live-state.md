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
- **PR #721 (supersedes #717):** atomic agent-home grants on a lead-owned branch. #717's code and generated artifacts were preserved, but its `P-L5` branch classification could never legitimately own the agent, gateway, manifest, and generated paths. The current head is `8e9dd507`: it makes scheduler startup await its immediate adoption/repair tick, which removes the real daemon-readiness race. The matching golden flow now uses an isolated agent name. The full matrix is running in `40421110397`; it must still clear the existing fixture/golden scope contracts and receive independent review before merge.
- **PR #715:** Files mirror branch includes the merged #517 changes. Its earlier `l2-heavy` failure depends on #717; re-run and enqueue only after #717 lands.
- **PR #719:** replaces desktop CI placeholder with blocking macOS and Windows package builds, ad-hoc Mac signing proof, shell smoke, and artifacts. Run `40417003122` is still active; its ordinary PR suite currently sees the same agent-owner test family, which must be resolved through #717, not suppressed.
- **Session discovery branch:** `build/P-L10_session-import`, native Codex and Claude metadata discovery is green in run `40417505140`. It uses immutable-only Codex SQLite and native bridge discovery for both providers.
- **Session import capability:** PR #720 has landed the typed `sessions.import` and `sessions.continue` slice, including consent, immutable provenance, mapping/fallback, incremental conflict records, and linked live continuation. Owner/source isolation remediation has landed at generated head `8d8ae8f8`, but independent review correctly found a remaining routing blocker: a Personal-default import begun in a Team view still used the ambient Team space. The lane is now implementing concrete, authorized Personal/Team destination routing with an integration test; do not approve until that is pushed, regenerated, reviewed, and green.
- **Desktop CI:** PR #719's macOS build, ad-hoc signature verification, packaged-shell smoke, and capture passed. Windows has built and is in packaged-shell smoke.
- **Session discovery security remediation:** `a06d81e9` percent-encodes immutable SQLite paths and redacts Git remote userinfo before metadata crosses the bridge. Check and security workflows are in progress.
- **Release infrastructure:** buildx runners and the isolated release signing runner are online. No runner-label mutation is needed. Apple Developer identity is unavailable; RC uses ad-hoc Mac signing and must state its Gatekeeper behavior.

## Primary evidence locations

- Release contract: `docs/superpowers/specs/2026-10-27-v1-release-candidate-contract.md`
- Execution plan: `docs/superpowers/plans/2026-10-27-v1-release-candidate.md`
- Canonical handover: `/Users/irfad/Claude/Orgs/Vyre/team/v1/HANDOVER-2026-10-27.md`
- Current production-export captures: `/tmp/vyre-shots.LKFtVn/` and `/tmp/vyre-715-shots.yAQRMA/`
