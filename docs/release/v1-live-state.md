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
- **Merged PR #721:** atomic agent-home grants, reassignment correction, and scheduler readiness landed on `main` as `3d8ef650`. Fresh CI and independent review passed. GitHub does not allow the author to approve their own PR; owner authorized the compliant reviewed admin merge rather than a branch-protection mutation. Advance dependent #715 from this mainline.
- **Merged PR #715:** Files mirror landed as `465d6423` after rebasing from #721 and passing full CI/review. Mirror invokes now resolve the agent's live owner on every pass, use the owner ID as `actingFor`, and have focused reassign/missing-owner regression coverage.
- **PR #719:** replaces desktop CI placeholder with blocking macOS and Windows package builds, ad-hoc Mac signing proof, shell smoke, and artifacts. Windows exposed a real smoke-script defect: the package process was not PID-tracked and a failed sidecar-state assertion was swallowed. Current head `de31f1dc` adds bounded PID cleanup and fail-fast semantics; its fresh desktop + full matrix is active. Treat any persistence failure as real until proved otherwise.
- **Session discovery branch:** `build/P-L10_session-import`, native Codex and Claude metadata discovery is green in run `40417505140`. It uses immutable-only Codex SQLite and native bridge discovery for both providers.
- **Session import capability:** PR #720 has the typed `sessions.import`/`sessions.continue` slice, consent, immutable provenance, mapping/fallback, incremental conflicts, owner/source isolation, and fail-closed destination-provider guard. The correct cross-Space provider needs an authenticated directory and capability-invocation transport for Personal/Team daemon endpoints; the current desktop launcher only runs one local device sidecar and has no such platform API. Do not claim cross-Space Team import complete until that platform contract and two-daemon proof exist. Owner decision is required whether to build that contract now or ship Personal-only RC import and defer confirmed Team import.
- **Desktop CI:** PR #719's macOS build, ad-hoc signature verification, packaged-shell smoke, and capture passed. Windows has built and is in packaged-shell smoke.
- **Session discovery security remediation:** `a06d81e9` percent-encodes immutable SQLite paths and redacts Git remote userinfo before metadata crosses the bridge. Check and security workflows are in progress.
- **Release infrastructure:** buildx runners and the isolated release signing runner are online. No runner-label mutation is needed. Apple Developer identity is unavailable; RC uses ad-hoc Mac signing and must state its Gatekeeper behavior.

## Primary evidence locations

- Release contract: `docs/superpowers/specs/2026-10-27-v1-release-candidate-contract.md`
- Execution plan: `docs/superpowers/plans/2026-10-27-v1-release-candidate.md`
- Canonical handover: `/Users/irfad/Claude/Orgs/Vyre/team/v1/HANDOVER-2026-10-27.md`
- Current production-export captures: `/tmp/vyre-shots.LKFtVn/` and `/tmp/vyre-715-shots.yAQRMA/`
