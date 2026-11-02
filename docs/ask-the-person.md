# Ask the person

An outside agent (Claude Code, Codex, any MCP client) acts for the person who connected it. Some things only a person does here: sign-in, members and invites, access, devices, the Gate's rules, the company's connections, the engineer tools. Before this change the MCP door refused those calls with `person_only`, and a refusal was a dead end: the agent could not finish what the person asked, and the person got no card.

Now the call waits for that person. They see an approval card, approve it with one press, and it runs as them.

## What happens

1. The agent calls a person-only tool, or a tool its own role does not carry.
2. The MCP door (`agent/src/mcp/outside.ts`, `outsideDoor`) sorts the call:
   - `open`: runs as the agent acting for the person, as before. If the pipeline refuses it with `role_lacks_permission`, it is asked like `ask` (`askPerson: "if_refused"`).
   - `ask`: never runs as the agent. The seed says `askPerson: "always"`.
   - `paste`: `vault_item_put` and `vault_request`. A key request for the name only; see Vault below.
   - `off`: the terminal, Vyre computers, local tools and the rest of the Vault. Refused (`not_from_outside`).
3. The invoke pipeline (`host/src/invoke.ts`) authorizes the agent as usual, then the person alone (`principal` = the person, no `actingFor`). If the person cannot do it either, the call is refused and the answer says an owner or admin has to (`person_lacks_role`). Otherwise it parks.
4. The Gate parks it as an ask hold (`gate.park` with `ask: { by, what }`). The hold's principal is the person, so the approval token and payload hash are bound to the person, this capability and this exact input. The hold names the agent in `asked_by`. The approver is that person and nobody else; unanswered, it is dropped, never passed to a delegate.
5. The person sees an Approve task in Needs you, and a card in the chat the agent works in when it has one. The card says what happens (the capability's own summary), which agent asked, that it runs as them once, and every input as a row. Secrets on it are Vault handles only: `gate.park` refuses an ask whose input carries a raw value in a field named like a secret.
6. Approve goes through `tasks.act` and `gate.release` as today. `gate.release` lets an ask hold through only on the person's own press from their own signed-in device (`claims.by` is the hold's person, no `forPerson`). It re-invokes the call as the person, with the approver's own session, so the person's role is checked again at that moment. The answer is kept on the hold and goes back to the agent through `agents_next` (`modules/mcp`, `onHoldAnswered`).
7. Decline goes back as "Not approved. <tool> did not run." with the person's note.

## Rules held

- The agent gets no role and no grant. Approval covers one call with one input. Held to sending is one guarded update, and a released hold is `approved`, so a second press or a replayed token is refused.
- Flood guard (lead ruling, 3 Nov): an agent has at most one open ask per capability and input; asking again returns the same pending hold and draws no second card. It has at most 5 open asks for one person; past that it is told "You have 5 requests waiting for <name>. Wait for an answer." and no card is made.
- Inputs cannot change after approval: `tasks.act` refuses edits on a held act, `gate.release` checks the stored input hash and the token's payload hash.
- The person must hold the role. If they do not, today's refusal stands, with the reason and a pointer to an owner or admin.
- Every ask is logged: a `hold` audit row with reason `asks_person` (agent, person, capability, time), the hold row (`asked_by`, `decided_by`, `decided_at`), `gate.requested` / `gate.approved` / `gate.denied` / `gate.expired` with `askedBy`, the run's own audit row as the person, and the agent's activity row.
- Nothing is allowlisted and no gate is removed. A tool that was off from outside is still off. A tool the door says only a person does never runs as the agent: the pipeline fails closed if it cannot park it.

## Reads

Person-only reads (`company_status`, `members_sso_list`, `members_invites_list` when the agent's role lacks it) follow the same rule as writes. The answer goes to a model Vyre cannot see and cannot label-check by provider, and it describes how the Space itself is set up. One approval returns one answer. An owner or admin who wants an outside agent to read these on its own can still give it the role in the Console.

## Vault

Vault values never reach or leave an outside agent. `vault_item_put` and `vault_request` from outside both become `vault.request` with `handleOnly: true`:

- the agent sends the key's name and field names; a call with any value is refused, nothing stored or echoed;
- the managers of the folder (or the Space's owners and admins) get the usual key request card and paste the value in their own app;
- the agent gets the key's name back to pass as a handle (`#Google_Client_Secret`), never the value and never Use on the item.

A call that needs a secret, like `members_sso_set`, takes its handle. Every other Vault tool stays off from outside.

## What stays in the person's app

Steps that need the person's own sign-in or unlocked key are not in the held call. The paste card is the Vault's. The owner's "sign in once" for Connect your company happens on that page; an approved `company_*` call that needs it first answers with that precondition, and the agent relays it.

## Not in scope

In-app agents keep today's behaviour. The pipeline flag is general, and a later change can set it from the chat engine.

## The setup grant (owner ruling, 3 Nov)

Most people will have their own agent set the Space up for them, so an owner or admin can skip the cards for setup.

- **One explicit grant at connect time.** The Allow screen offers an owner or admin two choices: "Act for me, including setup" (their default) and "Ask me first". One plain line says what the first means. A member sees no choice, and `mcp.oauth.allow` with `setup: true` from a member is refused.
- **Stored on the agent.** The grant lives in `mcp_setup_grants`, one row per agent. The person switches it in Settings > Outside agents (`mcp.setup.set`). An owner or admin sees every connected app in Console > Agents and actors and can turn setup off; only the agent's own person turns it on. No agent can reach `mcp.setup.set`. The grant is read on every call, so taking it back counts at the next one.
- **What it covers** (`setupCovers` in `agent/src/mcp/outside.ts`): `members.*`, `company.*`, `settings.*`, `connections.*`, `connectors.*`, the company directory connections (`google.dwd.*` and the Microsoft tenant), the Space's AI keys (`providers.add`, `providers.set_space_use` and the provider reads), and putting keys in the Vault (`vault.item.put`, `vault.item.update`, folders, and the item list).
- **With it,** a call in that scope that the agent may not make itself runs as the person, through the same pipeline branch that would have parked it (`setupGrant` on the seed). The person's own access is checked on the call. If they lack the role, today's refusal stands. An audit row (reason `setup_grant`) names the agent and the person, and the run's own row is the person's. No card is made.
- **Secrets.** With the grant, the agent may pass values to `vault.item.put`, `providers.add` and calls like `members.sign_in_github.set`. They go straight to the Vault, encrypted, and are never echoed or logged. `members.sso.set` still takes its client secret as a handle: put it with `vault_item_put` first. A Mine item needs the person's key, which the server holds only while they are signed in. If it isn't held, the agent is told plainly that the person has to sign in once.
- **Unchanged with it:**
  - Anything outward (sends, posts, payments) never takes the grant: it keeps the Gate and the chat's Auto rules.
  - No secret is read back: `vault.item.reveal` and the exports stay off.
  - Access, the Gate's rules, agents, MCP sign-ins, devices, the network and Vault sharing are out of scope, so an agent can never give itself or another agent more rights.
- **Without it,** the approval cards and the flood guard work as described above.
