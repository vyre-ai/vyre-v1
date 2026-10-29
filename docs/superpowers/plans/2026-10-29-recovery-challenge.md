# Recovery challenge implementation

1. Add failing identity tests for recovery-only fetch, actual sealed-nonce proof, ciphertext-hash denial, replay/expiry, immutable key identity and post-password-hash races. Use kernel crypto in module tests; host HTTP tests must not import module implementations.
2. Add an internal identity_recovery_noise migration and recovery-code indexes. Export the existing kernel raw-private-to-public X25519 operation for deterministic fake public keys; add no custom crypto primitive.
3. Implement a dedicated identity recovery handler module, keeping keys.ts compatibility exports. Derive stable fake bytes via existing kernel HKDF and a private persisted Space seed. Issue bounded hashed one-use challenges with exact domain-separated bundle context.
4. Replace recovery_restore's ciphertext-hash authority with nonce lookup/CAS and key-bundle equality invariants; prevalidate before consuming, recheck membership/policy/current bundle after Argon. Keep existing legacy encrypted-bundle formats decryptable.
5. Add recovery_fetch manifest/handler registration and generate normal outputs plus snapshots. Send the exact generated contract to root and release the generation hold.
6. Run focused identity tests, actual encrypted-bundle daemon HTTP tests, architecture boundaries, changed-source lint and pinned semantic checks. Update changelog and evidence; push a narrow reviewable branch. Root performs client integration and exact combined CI.
