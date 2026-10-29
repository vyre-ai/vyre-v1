# Connector host handoff, 2026-10-29

Implementation stopped at the user-requested usage checkpoint. No new implementation is in progress.

## Checkout and review

- Worktree: `/Users/irfad/Claude/Orgs/Vyre/v1-wt/rc1-infra-acceptance`
- Branch: `codex/rc1-connector-host-seams`
- PR: https://github.com/vyre-ai/vyre-v1/pull/770 (draft; root owns integration)
- Last verified implementation head: `12e810ef`.
- This checkpoint adds only an explicit WIP regression and changelog. The new regression intentionally fails; do not merge it as green release evidence.
- Base is root `2177ec16`; parent root has since integrated Recovery through `49e564d7`, generated catalogue 2709. This branch still has 2708; reconcile before generating.

## Completed and committed

- `0d6393cd`: Personal Files roots stop inherited Space authority; canonical root-key repair runs before listening, preserves owner/labels/holds and explicit shares. HTTP tests cover Member denial, explicit share, unrelated person denial, Shared root unchanged, restart repair/idempotence.
- `5f0903a5`: connector init/export create real Files folders through original caller capability execution. Missing Files write denies and leaves no persisted synthetic connector/draft. Current init folder is Personal, not canonical editable Space source.
- `3dd726ba` plus mandatory `1f1ac446`: selected Connection/declared-slot-bound one-use Vault fill references, original caller/actingFor permissions, HTTPS declared-domain DNS-pinned network guard, secret scrubbing. No generic raw Vault secret resolver. Use both commits together.
- `12e810ef`: recheck Connection state/slot/published definition and authority after awaited DNS, before provider send. Actual HTTP pauses Connection during DNS and proves no send.
- Parent reports Vault integrated as `aee922e4` and independently 44/44 green; confirm whether `12e810ef` is also integrated before cherry-picking.

## Evidence

- `/tmp/vyre-connectors-host-full.log`: 85/85 targeted tests.
- `/tmp/vyre-connectors-send-state.log`: 21/21 after connection-state amendment.
- `/tmp/vyre-connectors-webcrypto-regression.log`: 4/4.
- `/tmp/vyre-connectors-vault-boundaries.log`: 3,602 files, zero architecture violations.
- `/tmp/vyre-connectors-vault-lint.log`: 13 files, zero violations.
- `/tmp/vyre-connectors-send-secrets.log`: 6,610 files, zero findings.
- New-source semantic checks clean; inherited daemon/Vault/sync errors remain in `/tmp/vyre-connectors-send-semantics.log`. This is not whole-repository semantic success.
- `/tmp/vyre-connectors-source-red.log`: new source test fails at first assertion, actual folder scope Personal versus required Space. Later assertions have not executed and remain unverified.
- Existing `docs/release/rc1-connectors-host.md` records authority and remaining gaps.
- Auth agent owns `apps/app/tests/console.connectors.live.test.ts`; real init/test/build/diff/publish/rollback/reload and webhook Connection lifecycle passed before Files port. Rerun on integrated latest source. Do not infer new UI proof from backend tests.

## Required next slice: canonical editable source (not implemented)

1. Add `cn_source_folders` mapping in Space record DB: connector key to canonical folder ID. Add optional `sourceFolderId` metadata contract. Register mapping before writing templates. Generated catalogue lock is released; coordinate with root before generation.
2. Write source under existing `shared_knowledge` Files root, `connectors/<key>`, `reviewChanges: true`. Export stays caller-Personal and never replaces source mapping. Legacy missing mapping: explicit Build creates source from stored definition; never scan or move Personal exports.
3. Review flag alone only stages agent edits. Ordinary Member inherited Space edit currently writes directly. Add narrowly bounded Files mutation guard for mapped source and affected ancestors/subtrees/changeset approval: require original caller `connectors.manage` Edit on connector AND normal Files authorization. Do not bypass either. During initialization before resource emission, only mapping creator with current Space Edit/connectors.manage may write. Test Member deny/proposal, developer/Owner success, structural moves/deletes and review approval.
4. Bind per-execution `loadFolderDef` using original Files get/list/read. Bound cumulative count/bytes/depth, reject denied/missing/truncated/raced source, recheck versions/membership and publisher authority after awaited tests before publication. Last good published definition remains unchanged until explicit successful publish. Resolve pending proposal behavior honestly.
5. Current `connector.toml` contains JSON. Accept legacy JSON, generate valid escaped TOML. Vendor pure parser from `connectors/hubspot/src/toml.ts` into shared lib without cross-layer import or new dependency; HubSpot compiler is OAuth-specific, not reusable generic compiler. Validate and roundtrip generic auth none/API/OAuth, actions and recorded tests. Preserve optional transforms.js, README and recorded source files. Existing writer allows only two-level actions/tests paths, so carefully extend bounded paths if needed.
6. Finish `host/tests/connectors.source.live.test.ts` red-to-green. It asserts Space source, metadata, Member protection, actual Owner file edits, recorded test/diff/publish and private export independence. Its later expectations have not been verified and may need contract-aligned corrections. Do not make production changes solely to satisfy an inaccurate test assumption.

## Required following slice: OAuth

Generic callback routing and encrypted Vault token storage are absent. Actual configured OAuth start is absolute and pending; generic callback HTTP currently returns 404. Implement provider callback/state consumption, original selected Connection ownership, encrypted token storage through bounded Vault authority, refresh/revocation and error handling. Do not report OAuth complete or invent success. Existing complete_auth rejects other-person state consumption before consuming state.

## Other explicit gap

Production Speed budget ingestion remains missing. UI trace inspection works, but timing fixtures are not measured performance or production producer proof. UserTiming app.start/app.usable/cmdk producers exist; logs.client_upload accepts entries, whereas Speed reads named spans. Parent deferred this behind connector user-action closure.

## Security boundaries to retain

- No global Vault secret read, arbitrary handle deputy, caller-selected principal or broad Files authority.
- One-use fill ref bound to caller kind/id, Space, actingFor, Connection, declared slot, handle and execution metadata; clean on all errors.
- Public base comes only from canonical configured address, never request Host.
- Provider requests HTTPS, declared domains, private-network/DNS checks, pinned socket, bounded same-origin redirects and response size; permission/state recheck after DNS.
- Secrets cannot enter URL/query templates; responses/errors/logs scrub filled values. Fixture raw Vault port reads remain zero.
- Canonical shared source and private exports have distinct privacy semantics. Never move private exports into shared source automatically.

## Operational constraints

No new dependencies, native builds or dependency copies. Disk is constrained. Serialize Expo using `/tmp/vyre-serial-export.py`; backend tests need no Expo. Irfad identity, no AI coauthor, changelog every code commit. Root owns review/integration; no merge performed.
