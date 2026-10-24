# Relay client

Dependency-free ES modules. The app, the Tauri shell, Node and the installer import the same files.

`PAIR_BASE` is `https://vyre.run/pair`. That host is a convenience. A Space overrides it with `pair({ pairBase })`, with the invite link origin, or with `VYRE_PAIR_BASE`. Invite links carry `code`, `fp` (the Space key fingerprint) and `addr`.

`pair()` is the only pairing stack. An invite code and a pair code take the same path. `serverPair` and `setupPair` are that function.

The device key defaults to a non-extractable X25519 key in IndexedDB (`deviceKey()`). `shellDeviceKey(invoke)` is the Tauri command path. It is not used unless `store` is `shell`, because an ad-hoc signed build cannot rely on the OS keychain.

Live bytes use Noise_IK (X25519, SHA-256, AES-GCM). Heartbeats are every 15 seconds. Events are numbered so a drop can catch up.

Tests run on Node 24: `relay/client/tests/pair.test.js` and `relay/client/tests/fuzz.test.js`.
