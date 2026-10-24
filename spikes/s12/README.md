# Spike S12: Tauri 2 shell, encrypted OPFS replica, vyred sidecar

Proof for the desktop shell before `apps/desktop` (lane L10) and `images/vyred` (lane L7b) exist.

The shell is a Tauri 2 app (`src-tauri/`). It loads the web build in `web/`, registers the `vyre` deep link, registers the global shortcut `CommandOrControl+Shift+V`, and spawns the `vyred` sidecar. macOS `signingIdentity` is `-` (ad-hoc). Windows target is NSIS (WebView2). Linux targets are deb and appimage (best effort).

The encrypted replica lives in an OPFS directory. Node has no OPFS, so the smoke test uses a private directory with the same file layout (`opfs.ts`) and `node:sqlite`. Values are AES-256-GCM. The key is HKDF-SHA256 over `replica|space|device`, the same construction as the sync spike codec. The web build uses `navigator.storage.getDirectory()` and Web Crypto with the same `iv || tag || ct` layout.

`s12.tauri.smoke.test.ts` reopens the replica in a second process and checks the sidecar health route from the UI client.

## Mac bundle

This worker has no Rust toolchain, and the repo rules forbid npm, so `tauri build` is not run here. `mac/build-adhoc.sh` compiles a small AppKit host, bundles the same web build and `vyred.py`, and ad-hoc signs it (`codesign --sign -`). The screenshot in `proof/` is that signed bundle, second launch, with the page connected to vyred.

```sh
sh spikes/s12/mac/build-adhoc.sh
```

## Tauri build (when cargo is available)

Sidecar files for the Unix triples sit next to `binaries/vyred.py` and are the same program. A Windows NSIS build needs `binaries/vyred-x86_64-pc-windows-msvc.exe` produced from that program. Then, from `spikes/s12/src-tauri`:

```sh
cargo tauri build
```

Crates are Tauri 2, `tauri-plugin-shell`, `tauri-plugin-deep-link`, and `tauri-plugin-global-shortcut` (MIT or Apache-2.0).
