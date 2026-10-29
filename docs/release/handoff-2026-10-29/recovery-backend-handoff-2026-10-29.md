# Recovery backend handoff

Stopped implementation at the user's request. No implementation changes remain uncommitted.

- PR: https://github.com/vyre-ai/vyre-v1/pull/771 (draft, attached to chat).
- Branch: codex/rc1-recovery-challenge.
- Head: 70d631f5775c1f380ac63e6f5d4cc3c90c699625 (pushed).
- Checkout: /Users/irfad/Claude/Orgs/Vyre/v1-wt/rc1-console-access-complete (reused clean checkout; directory name predates recovery branch).
- Source status: tracked files clean; only existing untracked node_modules symlink and shots-evidence/ remain.

## Commits and integration

- e4bd8baa: recovery challenge design/plan.
- c70bb0c5: sealed nonce protocol, recovery-only fetch, durable private fake seed, bounded challenges, host-owned atomic consume/account replacement/session revocation, migration, manifest/generated contract. Root integrated core as49e564d7.
- 09faee22: cherry-pick of root's0124dd06 immutable generic keys_put guard. Root already owns this change; do not duplicate it when integrating.
- **05e58894: remaining protocol-proof amendment to take**. Real encrypted-bundle HTTP tests; actual SQLite rollback/CAS tests; membership/policy/password/bundle races; quota cleanup/global bounds; fake initial epoch0 alignment. No late manifest changes.
- **70d631f5: final verified export-privacy test checkpoint**. This is also pushed; take after05e58894.

Fetch contract: identity.recovery_fetch({username}) returns recovery-only keys {personKeyByRecovery,publicKey,privateKeyWrapped,spaceKeys}, sealed challenge {eph,iv,ct,tag}, context and expiresAt. Never returns personKeyByPassword. Context is `vyre/recovery-challenge/v1|space|normalizedUsername|sha256b64(canonicalFullOldBundle)`; use the returned context verbatim as AAD. recoveryProof is the decrypted32-byte nonce encoded unpadded base64url.

## Verified evidence

- /tmp/vyre-recovery-final-proof.out: **34/34**, including real client-encrypted legacy-format bundles over actual daemon HTTP, wrong code/cipherhash denial, replacement-key rejection without challenge burn, exact key preservation/new password, old token/password denial/new-session success, replay/expiry, other old-bundle challenge invalidation and deterministic password race.
- Actual SQLite tests verify atomic credential/nonce/session updates, rollback after injected storage failure and CAS binding to person/username/verifier/full bundle/epoch/factor/purpose/expiry.
- Unit cases verify post-hash membership refusal/unavailability, stricter policy and bundle changes; bounded fake stability/epoch; per-account and global quotas and cleanup. Wrong public proofs preserve the saved recovery wrap and emit only declared failure metadata.
- /tmp/vyre-recovery-proof-lint.out:4 changed files,0 findings. Core lint14files0 was also retained.
- /tmp/vyre-recovery-proof-tsc.out: new/changed recovery source and tests have0 own diagnostics; transitive baseline diagnostics remain. Not a claim of repository-wide typecheck success.
- /tmp/vyre-recovery-boundaries.out:3620files,0 violations.
- /tmp/vyre-recovery-gencheck.out: generated2709files current. CI selector chooses all tests because the registry reaches503/1132 tests; no uncovered files. Do not run that full suite on this Mac; root owns combined CI.

The final export privacy assertion is committed as70d631f5: /tmp/vyre-recovery-export-privacy.out **3/3**, proving a synthetic identity_recovery_noise seed is absent from decompressed shared Space ZIP contents. Collector implementation is unchanged. The saved patch is retained only as an extra recoverable copy, not uncommitted work: /Users/irfad/Claude/Orgs/Vyre/team/v1/reports/recovery-noise-export-assertion.patch.

## Remaining acceptance and caveats

1. Root owns recovery client crypto/UI and its real browser proof. Backend crypto HTTP success does not mean the complete client recovery flow or release is finished. Exact combined CI remains root-owned.
2. Fake bundles are stable and recovery-only, with initial epoch0; they do not guarantee perfect account-enumeration resistance across all real bundle metadata/count variations. That limitation is explicit in the agreed design.
3. Challenge slots are bounded at5 per person/username and2000 globally, with five-minute expiry and fetch5/min/principal. Quotas may require waiting; they never erase a saved recovery code or replace a still-valid challenge on another fetch.
4. After an identity commit succeeds, a later network/session delivery failure must not be presented as an unchanged password. The client can sign in with the new password or fetch a fresh recovery challenge; it must not repeatedly spend the old nonce.
5. Legacy-format encrypted bundles without a new verifier are exercised; no migration of an actual user's legacy database was run here. The old ciphertext-hash authorization path is removed, and migration clears its stored hash column.

Earlier Console handoff and unfinished12-page checklist: /Users/irfad/Claude/Orgs/Vyre/team/v1/reports/console-2026-10-29-0433.md. Template059464c6 is preserved on the prior Console branch; root owns its integration. Actual Docker Computer lifecycle acceptance remains blocked on this Mac's unavailable Docker server, not replaced by fake proof.
