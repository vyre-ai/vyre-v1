# Recovery challenge design

Approved release design: prove possession of the account's existing X25519 private key, obtained by locally opening its recovery-wrapped person key. Never authorize recovery with a hash of ciphertext. This supports existing encrypted bundles without a new signup verifier.

Anonymous `identity.recovery_fetch({username})` returns only the recovery wrap, public key, wrapped private key and Space wraps, plus a sealed random32-byte challenge, its exact context and five-minute expiry. It never returns the password wrap. Context is `vyre/recovery-challenge/v1|space|normalizedUsername|canonicalFullBundleSha256`; the hash includes the password wrap. The client returns decrypted nonce bytes as unpadded base64url in the existing `recoveryProof` field.

Store only `sha(recovery:nonce)` in identity_codes, bound to person/current bundle hash. Limit five outstanding challenges per account/username and2,000 globally; remove only expired/used rows. Fetch is rate-limited to five/minute/principal. Unknown/no-recovery accounts receive plausible recovery-only fake bundles generated with a private durable Space noise seed, and sealed fake challenges. Shape fakes do not promise perfect account-enumeration resistance.

Restore validates input and all unchanged identity/recovery/Space wraps, verifies live membership/policy, hashes the new password, then re-reads account/current bundle/policy/challenge before spending the nonce once and changing the password wrap. Revoke prior sessions and issue a verified recovery session. No wrong attempt permanently destroys a saved recovery credential. No raw code, nonce, person key or challenge secret enters logs/events/persistent plaintext.

Root owns client crypto/UI. This lane owns manifest/generated contract, migration, kernel helper if needed, identity handlers and security tests. SessionGate is outside this lane.
