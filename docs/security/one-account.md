# One Vyre account across Spaces (rc.14, rc.17)

A person has one Vyre account: one username, one password, one recovery code and one key pair, in every Space they are in. Each Space stores the account's key bundle as ciphertext. The person key inside it is opened only on the person's own device. A server never hands a person key to anyone (ruling 62).

## Bringing the account to a new Space

| Device | What the person does | What crosses the network |
|---|---|---|
| Signed in to a Space with a password (rc.14) | "Continue as": types the password | `identity.keys_get` from the known Space |
| Signed in to a Space only with Google, Microsoft or GitHub (rc.17) | "Continue as": types the password they set when they joined, or their recovery code. With the code they choose a password once | `identity.security.get` (the username) and `identity.keys_get` |
| No session at all (rc.17) | "I already have a Vyre account": enters a Space's address, then signs in there with the username and password | `identity.sign_in` at that Space, which returns the bundle; `identity.sign_out` at once |
| No session, and that Space uses Google, or the password is gone | The same screen: username and recovery code, then a new password once | `identity.recovery_fetch` (anonymous, rate limited, audited): the recovery wrap and key pair, never the password wrap |

In every case the device opens the bundle (`client/src/crypto/keys.ts`: `carryBundle`, `carryWithRecovery`) and sends the new Space the same wraps and key pair, plus a new Space key sealed to the same public key. After a recovery-code carry, the new Space gets a new password wrap. The recovery wrap and key pair do not change. The device stores the username on the new Space's session, and on the provider-only session when the password opened it, so the person meets this step once per device.

Not built (option B, put to the owner): handing the person key, which the server keeps behind a provider sign-in (`host/src/seams/key-wraps.ts`), to an authenticated session. It would let whoever controls a member's Google identity take the key off the server, and with one account that reaches every Space. With option A, a Google sign-in alone opens the person's Vault on that server only. Bringing the account to another Space still takes the password or the recovery code.

A Google button on "I already have a Vyre account" is also not built. The SSO return goes only to the Space's own origin or loopback, so a Google sign-in at A cannot hand a session to a page served by B. A device with no session uses the recovery code there.

## Use one account everywhere (rc.17)

For two accounts made before one account worked across Spaces (Settings, Sign-in). The person picks the account to keep. They prove it with its password, and the other with its password or its recovery code. The device builds the other Space's new bundle with `linkBundle`:

- the kept account's password and recovery wraps and its key pair;
- each of that Space's keys, opened with its old private key and sealed again to the kept public key at the same epoch;
- `formerKey`: the key that Space's data is under, sealed under the kept person key (AES-256-GCM, purpose `vyre/person-key/v1/former-key`). That is the Space's old person key, or its own earlier `formerKey` if it was linked before.

`identity.link_account` (audit always, 5 per 5 minutes) checks the proof of that Space's account: its password, or a one-use recovery proof from `identity.recovery_fetch`. It refuses a username held by someone else there, a bundle without `formerKey`, a different set of epochs, or the same key pair. It then takes the username, the password verifier and the bundle. Every session of the person there ends, which drops their key from server memory and drops its wrap. The device gets one new session. It emits `account.linked` (from, to), `password.changed` and `keys.stored` (reason `link`). The person id, role, groups, membership and data do not change.

From then on, every unlock in that Space opens `formerKey` and hands that key to the Space (`heldKeyOf`), so Mine items, private chats, personal memory and the runtime opt-in stay readable. `keys_put` cannot drop or swap `formerKey`. A password change, a recovery and a new recovery code keep it. A carry from a linked Space never takes it along.

Known residue: `identity.recovery_fetch` returns `formerKey` for a linked account, so a caller who knows the username can tell that the account was linked. They learn nothing else.
