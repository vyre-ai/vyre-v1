# Frozen note: access.clears (lane f-keyreach, 14 Nov 2026)

## What is added
- One new capability, `access.clears@1`, in `manifests/access.ts`, handler `clears` in `modules/access/handlers/share.ts`.
- One new optional output field, `askedYou` (boolean, only on `vault.requests.get`), on the `vault.request` row in `manifests/vault-requests.ts`. The `vault.requests.list`, `get` and `fulfil` rows carry the same optional field in their shared row type.
- A behaviour change in the Vault, no contract change: an agent acting for a person (`ctx.actingFor`, set by the server, never from input) now makes shared folders and keys OWNED BY THAT PERSON (`modules/vault/handlers/items.ts` `makerOwner`), and may make a folder in that person's Mine (never for nobody, never another person's Mine). Before, the agent owned them and a Mine folder was refused. The `owner` shown in Vault list rows for such a folder or key is now the person. The agent is recorded as the maker by the registrar stamp `made_by` (host/src/gateway/resources.ts, lane f-reach), not by a new column here. An agent acting for nobody still owns what it makes. Nothing widens who else can read or use anything.
- Nothing is removed, renamed or made required in the contracts. Both contract changes are additive.

## What it does
`access.clears { principal, target } -> { clears: boolean }`. It answers whether a principal's clearance reaches the label of a Vault folder or item (the thing's own label and every folder above it, read from the same snapshot authorize uses). Read only: it writes nothing, emits nothing, and is a `readOnly` handler.

## Why
A key typed for an agent was stored in a Restricted folder where the agent is refused above its clearance on every use. Callers (vault.requests.fulfil, the key request card, the Vault share sheet) ask this one rule before storing or sharing, instead of keeping a list of folder names.

## Who may call it
- The server (svc_host).
- A call another capability made (depth above zero and not forwarded for someone: `isSystemCall`). Event consumers run at depth above zero (`host/src/daemon/consumers.ts`), so a consumer's call counts as a system call too; only module code reaches it that way, never a person's own call (whether a user automation step can was not checked). `vault.requests.fulfil` asks this way: it is the server deciding where a key may land, not the caller browsing folders, so the answer is always readable.
- A person (or an agent acting for a person) who holds Edit on the target, through the gateway.
Anyone else, including a person who cannot see the target, gets `validation.not_found`.
`vault.requests.fulfil` fails closed on this answer: a no, a not found or an unreadable answer all refuse the store or the attach, before anything is stored.

## What it must never reveal
`vault.requests.fulfil` asks it with the server's authority, so it answers the same words for a folder that does not exist, one the caller cannot see, and one the agent cannot use ("That folder is restricted..."); a `not found` from the Vault's own put is turned into those words.
- Nothing about a target the caller cannot see: a hidden or missing target both answer `validation.not_found`, with the same message, so the call does not say that a folder exists or how it is labelled.
- It never returns the label, the clearance, the grants, the owner or the steps; only yes or no.
- The input field is named `target`, not `resource`, on purpose: the gateway runs its own access check on an input named `resource` first, and that check answers "above clearance", which would reveal a hidden folder.

## Snapshots
`docs/frozen/snapshots/access.json` and `docs/frozen/snapshots/vault-requests.json` were written by `node tools/gen/src/cli.ts --snapshots`.

## Test
`test/vault.agent-key-reach.live.test.ts` (a member asking about a hidden folder gets the same not found as for a made-up id) and `modules/vault-requests/tests/request.test.ts`.
