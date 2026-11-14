# Frozen note: access.clears (lane f-keyreach, 14 Nov 2026)

## What is added
- One new capability, `access.clears@1`, in `manifests/access.ts`, handler `clears` in `modules/access/handlers/share.ts`.
- One new optional output field, `askedYou` (boolean, only on `vault.requests.get`), on the `vault.request` row in `manifests/vault-requests.ts`. The `vault.requests.list`, `get` and `fulfil` rows carry the same optional field in their shared row type.
- A behaviour change in the Vault, no contract change: an agent acting for a person (`ctx.actingFor`, set by the server, never from input) now makes shared folders and keys OWNED BY THAT PERSON (`modules/vault/handlers/items.ts` `makerOwner`), and may make a folder in that person's Mine (never for nobody, never another person's Mine). The `owner` shown in Vault list rows for such a folder or key is now the person.
- So the agent that made it can use it with no help from anything else, `host/src/invoke.ts` (frozen path) writes an explicit grant to THAT agent on THAT folder (Edit) or key (Use): `by` the person, `source` `made-by:<agent>`, listed in the sharing list and removable by the person like any grant (people with Manage on it), never to another agent. The rule is one exported function, `madeForGrant` (record type: Manage, no source; site this call created: Edit; vault folder: Edit; vault key: Use), replacing the record-type-only block that was there; `InvokeDeps.madeFor` (clears, holds, inMine) is wired in `daemon.ts` from the access snapshot. The grant is written in the same commit as the birth, so there is no moment when the person owns it and the agent that made it is refused, and no grant for a thing never made.
- One order of checks for every kind (record type, site, Vault): the kind and level, then the owner must be the person the agent acts for, then the place must be within the agent's clearance, then the kind's own skips. The old record-type-only block granted without the owner and clearance checks; the registrar makes the person the owner of what an agent makes for them, so the owner check changes nothing in practice, and a record type in a place above the agent's clearance now gets no grant (host/tests/made-for-grant.test.ts).
- It is SKIPPED, not failed (the call still succeeds, the thing is the person's), when: the place is labelled above the agent's clearance (the agent's next call is refused above clearance in the usual model-error words); the agent already holds that level there through the Space or a role (a Team Space agent is born with Edit on the Space, so the grant would list the maker twice: in a Team Space it is therefore rarely written for shared folders and keys); or the thing is a key inside a person's Mine (the agent reaches Mine only while acting for the owner, Use is all a key needs).
- Mine: an agent acting for a person may make a Mine folder for them and put a key in it, then use it in that person's turns (`items.ts`: `forOwner`). The Mine FOLDER carries the maker's Edit grant, because the gateway asks Edit on a folder before an agent may put a key in it and the kernel gives an agent acting for the owner only Use there; for anyone else the call takes the lower of the agent's grants and that person's access, which in someone's Mine is none. The same agent acting for another person, and a person who is not the owner, get "not in this Vault".
- The grant does not outlive the owner (`modules/access/consumers.ts` `dropMadeBy`): an ownership transfer (`access.transfer_ownership`) removes it, a change of owner when the thing is registered again removes it, and a move above the agent's clearance removes it; a move between places the owner controls leaves it.
- Not changed, found on the way: every agent of a Team Space already holds Edit on the Space itself (a grant written at its birth), so any agent of the Space reaches shared folders and keys through that, whether or not the made-by grant is removed; the card says so.
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
