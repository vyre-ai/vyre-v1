# Changelog

## Unreleased
- Grok harness (scripts/workers): evidence.py for required-test parsing, pre-push check, CI state across pushes and evidence from CI job facts; grok-run.py gains foreign-failure rerun, desktop run wait, session continue for fix rounds, per-attempt usage with real cost, lower reasoning effort and context caps.
- Contracts: manifest types and builder DSL (packages/contracts), frozen declarations for the 72 modules plus 4 connectors and 4 Kits (manifests/), vyre-gen generator (tools/gen) with drift check, typecheck and generated contract tests.
- CI skeleton: affected-only selector, per-file capped test runner, pass cache by import closure hash, push/main/release/spike workflows.
- Repo bootstrap: npm workspaces scripts (gen, check, perf, golden, release), strict tsconfig.base.json (erasableSyntaxOnly, allowImportingTsExtensions, noEmit), Apache-2.0 LICENSE and NOTICE, CODEOWNERS for frozen paths, scripts/lanes.json (17 lane rows, 72 module owners, frozen paths), scripts/allowlist.json (initial third-party list), scripts/boundaries.json (layers, B1..B8 and exceptions).
