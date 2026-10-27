# Release runbook (v1)

How a tag becomes a release. The signing key is never on a person's computer: it exists only in the GitHub Environment `release` of vyre-ai/vyre-v1.

## Release signing environment

The `release` Environment is configured for vyre-ai/vyre-v1: it requires reviewer `irfad7`, permits `main` and `v*`, and holds `VYRE_SIGNING_KEY`. The dedicated `release-sign-1` and `buildx` runners are online. The key value is never printed, copied, or stored outside the Environment.

1. Before a real tag, verify that the Environment still requires `irfad7`, permits only `main` and `v*`, and retains `VYRE_SIGNING_KEY` without revealing its value.
2. Rotate `VYRE_SIGNING_KEY` only when needed. Two choices, the owner's:
   - Reuse the 0.6 key (backup in the owner's password manager). Its public half is already pinned in `scripts/install/linux/install.sh` and `scripts/install/linux/vyre-server` (`MCowBQYDK2VwAyEAKXSdujH7tO/gscXCJZmYCjB+Cv1sVlOfdgLNedMR7FU=`). Its raw 32-byte form, for the updates module, is `29749dba31fbb4efe0b1c5c22599980a307e0afd6c56539f7602cd79d311ec55`.
   - Make a new key (`openssl genpkey -algorithm ed25519`) inside the Environment's first run, never on a laptop.
3. In a job that runs in the `release` Environment, run `node scripts/release/cli.ts pubkey release-key.json`. It prints the public half (hex) and a key id from `VYRE_SIGNING_KEY`, and writes `{publicKey, keyId}`. This is the only thing that leaves the Environment.
4. Keep ONE self-hosted runner with the labels `self-hosted, linux, release-sign` and nothing else, on a host that runs nothing else (not a CI host: no other runner, no PR code ever runs there), with Docker, because the `sign` job runs in a container that is removed when it ends. No other workflow may name `release-sign`; `scripts/release/runner-label.test.ts` fails the build if one does. If that runner is unavailable, `sign` waits and nothing can be signed.
5. In Settings, Actions, General, set "Fork pull request workflows from outside collaborators" to "Require approval for all outside collaborators", and confirm it (the repo is public: a PR from outside must never run on a self-hosted runner without a person approving it).
6. Compile the public key in (a PR, reviewed): `RELEASE_PUBLIC_KEY_HEX` in `host/src/seams/updates.ts`; `RELEASE_KEY_PEM` in `scripts/install/linux/install.sh` and `scripts/install/linux/vyre-server`; the key in `scripts/install/windows/install.ps1`. Until step 6, a build refuses every feed (it fails closed), so nothing can install.

## Before a release

- `node scripts/release/cli.ts bump <version>` on a PR; the tag must equal the version (a prerelease is `1.0.0-rc.1`).
- Patch releases (a tag not on main): the commit is on `origin/hotfix/<tag>`, the tag is the next patch of the newest published stable release. `node scripts/release/cli.ts lineage <sha> <tag>` refuses anything else; the workflow runs it first.
- Check the real-install walk of a fresh Space (spec b14).

## What the tag does (release.yml, budget 25 minutes tag to live)

A tag whose name contains `dryrun` is a practice run: everything below runs except sign, publish and smoke, and no image is pushed.

1. `guard`: the tag must be a release version (`v1.2.3`, `v1.2.3-rc.1`) equal to `package.json`; a commit that is not on main must pass `cli.ts lineage` (the next patch of the newest published stable release, on `origin/hotfix/<tag>`). A release goes to `stable`; a beta or rc goes to `beta`.
2. `package`, in parallel with the tests: the app web export (`expo export`), the server image pushed to ghcr.io/vyre-ai/vyred and pinned by digest, the agent-computer image is built with Vyre for Chrome copied into its `vyre-chrome/` first (`cli.ts stage-chrome`) and `cli.ts image-has-chrome` fails the release if the built image lacks `/opt/vyre-chrome/manifest.json` or any extension file; it is pushed by digest and goes into `images.lock` as `VYRE_AGENT_IMAGE`; then `cli.ts pack` builds `vyre.tgz` (VERSION, compose.server.yml, Caddyfile, images.lock, bin/vyre-server, units), `vyre-app-web.tgz`, `vyre-chrome.zip`, `vyre-kits.tgz` and `releases.json`. install.sh and install.ps1 are attached unchanged.
3. `select` and `suite` (the whole suite, no perf), beside `client`, `kits`, `images`, `heavy`, `security`. `native` and `desktop` run too but never block going live. The macOS desktop build checks out the tag SHA, clears cached bundle outputs, builds the ad-hoc-signed app and exactly one DMG, verifies its code signature and DMG image, then `desktop-release-files` adds that DMG and a SHA-256 sidecar to the release payload. Windows remains CI coverage only: no NSIS installer is published.
4. `live` waits for guard, package, suite, client, kits, images, heavy and security. The 25 minute budget is measured to here and to `deploy`; sign, publish and smoke wait for a person and are outside it.
5. `sign`, in the `release` Environment, after its reviewer approves: waits for `desktop-release-files`, reads `RELEASE_PUBLIC_KEY_HEX` from `host/src/seams/updates.ts` (empty means the owner action is not done, and it stops), then `cli.ts sign dist <channel> <pub>` signs one entry per channel that has an artifact (app, server, kits, extension; the others are left out) and refuses a key that is not the compiled-in one, then `cli.ts assets dist` writes `<channel>.json`, `<channel>.json.sig` and `<channel>-<kind>.json[.sig]`.
6. `publish`: `gh release create <tag>` with every file (a prerelease for beta), including the exact-tag ad-hoc-signed macOS DMG and its `.sha256` sidecar; a prerelease channel also updates the rolling release `channel-beta` (created on first use), which is where `feedBase("beta")` reads. `stable` is read from the newest published non-prerelease release. Ad-hoc signing is not notarization, so Gatekeeper may still warn.
7. `smoke`: a fresh runner fetches the published channel from the feed address, verifies the signature with the compiled-in key, downloads the server tarball, checks its sha256 against the signed manifest, and looks inside it for the files the installer needs and the version (`cli.ts smoke`). A failure is a release that cannot be installed.
8. `deploy` (still a placeholder) and `budget-tag`.

## If it goes wrong

- A red check on a flake: rerun the failed jobs; do not retag. If the run must be redone at the same commit, delete and recreate the tag at the same sha.
- A bad signature on a published release: delete the release assets; servers refuse an unsigned or wrongly signed manifest and stay on the version they run.
- Rolling back a server: `vyre-server rollback` (code only; data written by the newer version stays), or `updates.rollback` in the Console.

## Status of this runbook

Built and covered by scripts/release/release.test.ts and scripts/workflows.test.ts: tag check, lineage, pack (server tarball, extension zip, app and Kits tarballs), releases.json, sign, assets, smoke, the macOS desktop artifact gate, DMG checksum, and publication attachment. In release.yml the guard and package jobs run on every tag (practice runs included); the protected release Environment, signing key and dedicated signing/build runners are configured, but sign, publish and smoke have not yet run for a real release. `package` runs on the runner label `buildx` (docker buildx and qemu for arm64), which one host serves (vyre-ci-7, eight runners). The label is lost if a runner is re-registered with `--replace`; a release stops with a clear message if the runner has no buildx. The Tauri macOS artifact is built and published as an ad-hoc-signed DMG; mobile artifacts and real deploy remain deferred. The Linux node is the server tarball plus its image; there is no separate Linux binary.
