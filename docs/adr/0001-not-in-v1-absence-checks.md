# 0001. Not-in-v1 items are enforced by an absence check

Status: accepted (P-L11_16).

## Context
V1-SPEC section 6 and "Not in v1 (owner, 24 Oct)" exclude Lumen, Mac and Windows control, voice agents and the meeting bot,
billing, phone AutoFill providers, and Vault passkeys. Left to review, one of them returns through a dependency or a copied 0.6 file.

## Decision
`scripts/absence/absence.ts` holds one rule per excluded item. It fails on a tracked source file under a layer package or app
whose path, or whose import specifier, names a forbidden word (for example `local/hands-*`, `voice-agent`, `billing`, `passkey`).
`scripts/absence/run.ts` also checks this index and runs `tools/gen --check`, which covers `generated/docs`.

## Consequences
- Frozen contract text (`generated/`, `manifests/`, `packages/contracts`, `docs/`) is not scanned: a frozen capability id such as `identity.passkey_register` is data, not code.
- A rule changes only with a lead ruling that also edits the spec section.
- Wiring `node scripts/absence/run.ts` into `.github/workflows/check.yml` belongs to the lead (workflows are not an L11 packet file).
