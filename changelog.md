# Changelog

## Unreleased
- Desktop: stop the local sidecar through its loopback admin endpoint before process fallback, so Windows removes `vyred.json` on a requested shutdown.
- Desktop smoke: use Windows Ctrl-Break for graceful sidecar shutdown, preserving the cleanup and restart proof before bounded force cleanup.
- Desktop smoke: apply the owner-only mode-bit check only on POSIX hosts while retaining cross-platform token persistence coverage.
- Desktop smoke: bound Windows sidecar shutdown and prevent failed heavy tests from hanging CI.
- Desktop CI: bound packaged-shell readiness and guarantee Windows process cleanup on exit.
- CI: replace the desktop placeholder with blocking macOS and Windows packaging, Rust tests, policy checks, packaged-shell smoke coverage, and captured proof artifacts.
- Release: set the root package version to the intended `1.0.0-rc.1` candidate tag.
- Gateway: generate contract-valid, revocable ids for an agent's Space and home grants.
- Access: resolve gateway actor-kind home grants to their registered agent or person principal during projection.
- Computer home mirrors now invoke agent file operations on behalf of the agent's current owner.
- Scheduler: await the initial immediate repair tick before reporting the daemon started.
- Fix: keep the missing-item fallback snapshot stable so Mail and Automations do not enter a production React render loop before an item is selected; reset place failures on route changes.
- Agents: include deterministic idempotency keys in the `access.share` inputs as required by the capability contract.
- Contracts: manifest types and builder DSL (packages/contracts), frozen declarations for the 72 modules plus 4 connectors and 4 Kits (manifests/), vyre-gen generator (tools/gen) with drift check, typecheck and generated contract tests.
- CI skeleton: affected-only selector, per-file capped test runner, pass cache by import closure hash, push/main/release/spike workflows.
- Repo bootstrap: npm workspaces scripts (gen, check, perf, golden, release), strict tsconfig.base.json (erasableSyntaxOnly, allowImportingTsExtensions, noEmit), Apache-2.0 LICENSE and NOTICE, CODEOWNERS for frozen paths, scripts/lanes.json (17 lane rows, 72 module owners, frozen paths), scripts/allowlist.json (initial third-party list), scripts/boundaries.json (layers, B1..B8 and exceptions).
