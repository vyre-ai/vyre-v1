# Changelog

## Unreleased
- CI skeleton: affected-only selector, per-file capped test runner, pass cache by import closure hash, push/main/release/spike workflows.
- Repo bootstrap: npm workspaces scripts (gen, check, perf, golden, release), strict tsconfig.base.json (erasableSyntaxOnly, allowImportingTsExtensions, noEmit), Apache-2.0 LICENSE and NOTICE, CODEOWNERS for frozen paths, scripts/lanes.json (17 lane rows, 72 module owners, frozen paths), scripts/allowlist.json (initial third-party list), scripts/boundaries.json (layers, B1..B8 and exceptions).
- @vyre/lib (P-PR_02): ids, canonical JSON, urn, hlc with the 5-minute skew clamp, markdown helpers, line and word diff, expression language and conditions, acme (csr, certs, dnswait, issue), and route() shared by client and server. Tests: route, hlc skew property (200 seeded cases), expr, core, md and diff.
