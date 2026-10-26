# Release runbook (v1)

How a tag becomes a release. The signing key is never on a person's computer: it exists only in the GitHub Environment `release` of vyre-ai/vyre-v1.

## The one owner action (once, before the first real tag)

The repo has no `release` Environment yet (checked 26 Oct: `gh api repos/vyre-ai/vyre-v1/environments` is empty). Create it, then give it the key.

1. GitHub, vyre-ai/vyre-v1, Settings, Environments, New environment `release`. Required reviewer: irfad7. Deployment branches and tags: `main` and `v*` only.
2. Add the secret `VYRE_SIGNING_KEY` (a PKCS8 PEM Ed25519 private key). Two choices, the owner's:
   - Reuse the 0.6 key (backup in the owner's password manager). Its public half is already pinned in `scripts/install/linux/install.sh` and `scripts/install/linux/vyre-server` (`MCowBQYDK2VwAyEAKXSdujH7tO/gscXCJZmYCjB+Cv1sVlOfdgLNedMR7FU=`). Its raw 32-byte form, for the updates module, is `29749dba31fbb4efe0b1c5c22599980a307e0afd6c56539f7602cd79d311ec55`.
   - Make a new key (`openssl genpkey -algorithm ed25519`) inside the Environment's first run, never on a laptop.
3. In a job that runs in the `release` Environment, run `node scripts/release/cli.ts pubkey release-key.json`. It prints the public half (hex) and a key id from `VYRE_SIGNING_KEY`, and writes `{publicKey, keyId}`. This is the only thing that leaves the Environment.
4. Compile the public key in (a PR, reviewed): `RELEASE_PUBLIC_KEY_HEX` in `host/src/seams/updates.ts`; `RELEASE_KEY_PEM` in `scripts/install/linux/install.sh` and `scripts/install/linux/vyre-server`; the key in `scripts/install/windows/install.ps1`. Until step 4, a build refuses every feed (it fails closed), so nothing can install.

## Before a release

- `node scripts/release/cli.ts bump <version>` on a PR; the tag must equal the version (a prerelease is `1.0.0-rc.1`).
- Patch releases (a tag not on main): the commit is on `origin/hotfix/<tag>`, the tag is the next patch of the newest published stable release. `node scripts/release/cli.ts lineage <sha> <tag>` refuses anything else; the workflow runs it first.
- Check the real-install walk of a fresh Space (spec b14).

## What the tag does (release.yml, budget 25 minutes tag to live)

1. `select` and `suite`: the whole suite (a tag has no base to select against).
2. `client`, `kits`, `images`, `heavy`, `security` run beside it. `native` and `desktop` run too but never block going live (`continue-on-error`).
3. `live` waits for suite, client, kits, images, heavy and security.
4. SIGN, in the `release` Environment, after the reviewer approves: the job builds `releases.json` (one entry per channel that has a new artifact: app, server, kits, extension; the others are left out, staggered releases are normal), then
   `VYRE_SIGNING_KEY=... node scripts/release/cli.ts sign <dir> <stable|beta|nightly> <public-key-hex>` signs each entry and refuses a key that does not match the pinned public key, then
   `node scripts/release/cli.ts assets <dir>` writes the files to attach.
5. PUBLISH: attach `<channel>.json`, `<channel>.json.sig`, `<channel>-<kind>.json[.sig]` and the artifacts to the GitHub Release of the tag. `stable` is read from the newest published (non-prerelease) release; `beta` and `nightly` from the rolling releases tagged `channel-beta` and `channel-nightly`.
6. `deploy`, then the post-deploy smoke: a booted server reads `<channel>.json`, verifies the signature with the compiled-in key (`updates.check`) and reports the new version available.
7. `budget-tag` reads the wall time against the 25 minute budget.

## If it goes wrong

- A red check on a flake: rerun the failed jobs; do not retag. If the run must be redone at the same commit, delete and recreate the tag at the same sha.
- A bad signature on a published release: delete the release assets; servers refuse an unsigned or wrongly signed manifest and stay on the version they run.
- Rolling back a server: `vyre-server rollback` (code only; data written by the newer version stays), or `updates.rollback` in the Console.

## Status of this runbook

Steps 1 to 3 of "What the tag does" run today (release.yml). Steps 4 to 6 (sign, publish, smoke) are not in release.yml yet: `deploy.yml` is a placeholder. See docs/release/dry-run.md for what the practice run covered.
