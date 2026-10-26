# Changelog

## Unreleased
- Desktop smoke: bound Windows sidecar shutdown and prevent failed heavy tests from hanging CI.
- Desktop CI: bound packaged-shell readiness and guarantee Windows process cleanup on exit.
- CI: replace the desktop placeholder with blocking macOS and Windows packaging, Rust tests, policy checks, packaged-shell smoke coverage, and captured proof artifacts.
- Fix: keep the missing-item fallback snapshot stable so Mail and Automations do not enter a production React render loop before an item is selected; reset place failures on route changes.
- Contracts: manifest types and builder DSL (packages/contracts), frozen declarations for the 72 modules plus 4 connectors and 4 Kits (manifests/), vyre-gen generator (tools/gen) with drift check, typecheck and generated contract tests.
- CI skeleton: affected-only selector, per-file capped test runner, pass cache by import closure hash, push/main/release/spike workflows.
- Repo bootstrap: npm workspaces scripts (gen, check, perf, golden, release), strict tsconfig.base.json (erasableSyntaxOnly, allowImportingTsExtensions, noEmit), Apache-2.0 LICENSE and NOTICE, CODEOWNERS for frozen paths, scripts/lanes.json (17 lane rows, 72 module owners, frozen paths), scripts/allowlist.json (initial third-party list), scripts/boundaries.json (layers, B1..B8 and exceptions).
