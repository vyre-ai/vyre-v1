# Changelog

## Unreleased
- Auth: discover sign-in choices through anonymous `identity.sign_in_options`, use authenticated Space identity for first-sign-in trust-on-first-use, verify remembered Space fingerprints before retaining the shell, and retain other Space sessions after a 401.
- Auth: brought the 0.6.8 account-form language into v1 with local password visibility, actionable account guidance, separated SSO and GitHub choices, and 44px-or-larger touch rows.
- Auth: expanded compact auth controls to 44px hit targets, omitted empty SSO sections, and made unavailable username suggestions truthful.
- Auth: added a bounded, motion-aware halftone field for the welcome and onboarding surfaces; it stays calm behind credential forms and never enters the signed-in shell.
- Auth: added the 0.6.8-style Welcome back / Connect a Space screen, HTTPS Space address normalization, and verified asynchronous handoff into existing credentials.
- Contracts: manifest types and builder DSL (packages/contracts), frozen declarations for the 72 modules plus 4 connectors and 4 Kits (manifests/), vyre-gen generator (tools/gen) with drift check, typecheck and generated contract tests.
- CI skeleton: affected-only selector, per-file capped test runner, pass cache by import closure hash, push/main/release/spike workflows.
- Repo bootstrap: npm workspaces scripts (gen, check, perf, golden, release), strict tsconfig.base.json (erasableSyntaxOnly, allowImportingTsExtensions, noEmit), Apache-2.0 LICENSE and NOTICE, CODEOWNERS for frozen paths, scripts/lanes.json (17 lane rows, 72 module owners, frozen paths), scripts/allowlist.json (initial third-party list), scripts/boundaries.json (layers, B1..B8 and exceptions).
