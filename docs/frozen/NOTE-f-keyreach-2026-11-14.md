# Frozen note: access.clears (lane f-keyreach, 14 Nov 2026)

## What is added
- One new capability, `access.clears@1`, in `manifests/access.ts`, handler `clears` in `modules/access/handlers/share.ts`.
- One new optional output field, `askedYou` (boolean, only on `vault.requests.get`), on the `vault.request` row in `manifests/vault-requests.ts`. The `vault.requests.list`, `get` and `fulfil` rows carry the same optional field in their shared row type.
- Nothing is removed, renamed or made required. Both changes are additive.

## What it does
`access.clears { principal, target } -> { clears: boolean }`. It answers whether a principal's clearance reaches the label of a Vault folder or item (the thing's own label and every folder above it, read from the same snapshot authorize uses). Read only: it writes nothing, emits nothing, and is a `readOnly` handler.

## Why
A key typed for an agent was stored in a Restricted folder where the agent is refused above its clearance on every use. Callers (vault.requests.fulfil, the key request card, the Vault share sheet) ask this one rule before storing or sharing, instead of keeping a list of folder names.

## Who may call it
The server (svc_host), or a person (or an agent acting for a person) who holds Edit on the target. Anyone else gets `validation.not_found`.

## What it must never reveal
- Nothing about a target the caller cannot see: a hidden or missing target both answer `validation.not_found`, with the same message, so the call does not say that a folder exists or how it is labelled.
- It never returns the label, the clearance, the grants, the owner or the steps; only yes or no.
- The input field is named `target`, not `resource`, on purpose: the gateway runs its own access check on an input named `resource` first, and that check answers "above clearance", which would reveal a hidden folder.

## Snapshots
`docs/frozen/snapshots/access.json` and `docs/frozen/snapshots/vault-requests.json` were written by `node tools/gen/src/cli.ts --snapshots`.

## Test
`test/vault.agent-key-reach.live.test.ts` (a member asking about a hidden folder gets the same not found as for a made-up id) and `modules/vault-requests/tests/request.test.ts`.
