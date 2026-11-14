# Made for me, usable by the maker (access rule, 14 Nov 2026)

Owner rule: what an agent makes, adds, asks for or connects for a person belongs to that person, the same agent can use it for them at once, the person sees it where they would look, and it stays private unless they share it.

## What is decided, and where
- **Who it is for:** only the turn's asker (`req.actingFor`). A shared agent asked by Q holds nothing of P's, including what it made for P earlier; a turn with no asker (a wake) holds nothing of anyone's. Test: `kernel/tests/authorize.made-for-me.test.ts`, "one agent, two askers".
- **What counts as made for the person:** `host/src/gateway/resources.ts` stamps `made_by = <agent>` on a resource the first time an agent acting for a person brings it into being, and only then (the stamp is written into `resource.created`, which only the host appends; no capability input can set it). `modules/access` keeps it in the resource row (`row_json.madeBy`), keeps it through moves and label changes, and rebuilds it from the tables.
- **Review fixes (r-keyreach, 14 Nov):** at Manage the agent holds the person's level only for a fixed list of caps (`MADE_BY_MANAGE`: sites, forms, automations delete, channel archive and update, project archive); sharing, publishing, links and member caps stay with the person, and a check with no capability name holds Edit. The agent role's permission is still required, except for the removal caps (`MADE_BY_REMOVE`, `MADE_BY_MANAGE`), which then follow the person's own permission. The stamp carries `made_for`; a transfer of the owner ends it. The private roots allow making and editing inside, and on the calendar root only `calendar.create_event`; a member's connected Google or Outlook calendar is a private root too, so an agent can add an event there for them (outward only if it invites someone). A calendar connected to Google or Outlook is NOT a private root for this rule (`outside` flag from the registrar), so writing to it keeps its own gate. A check that names no capability grants nothing on this path (fail closed).
- **Calendar events:** events are access resources inside their calendar (registered when made; an event already in the store is registered the first time a call names it, `ensureRow` in `host/src/daemon/daemon.ts`). Before this, get, update and delete of an event answered not-found to everyone.
- **What the agent may do:** `kernel/src/authorize/index.ts` `madeForPerson`: the person's own level on that resource, for that agent and that asker. `viaPrivateRoot`: up to Edit inside the asker's own private root (Personal files, Personal calendar); Mine in the Vault keeps `viaMine`.
- **Never by this rule:** `PERSON_ONLY` (sharing, granting, ownership, removing people), Vault items and folders, mailboxes, numbers, domains, agents and the Space, anything above clearance (a label still wins), anything the person does not own. The person's own access is still checked and is the ceiling.
- **Destructive acts:** remove, archive and delete follow the Gate's existing `delete` hold for an agent (files, records, sites, forms, automations already; channels.archive and projects.archive now too, for agent actors only). Never `no_grant`, never silent.
- **Outward acts:** a calendar event is held only when it invites someone (`len(input.attendees) > 0`). The old condition `input.attendees != null` could not be read by the expression language, so every agent event was held.

## Existing rows
No migration. `made_by` lives in the access resource row (`row_json`), a column that already exists, and rows without it simply have today's level. Nothing is backfilled by guessing who made an old thing.

## Left alone, on purpose
`computers.provision` (a Space resource with a cost) and `connectors.init` (names hosts that receive keys; it keeps its one Allow). The model is told the true reason in a line (`agent/src/tools/model-error.ts`).

## Not changed here (lanes)
The Vault: an agent making a folder in the asker's Mine, and a shared folder or key an agent makes being owned by the person with `made_by` the agent, are in `modules/vault/handlers/items.ts` and `modules/vault/handlers/folders.ts` (lanes f-keyreach2 and b-connect).

## For signing
Lead: this note, the authorize change, the two manifest gates (channels.archive, projects.archive) and the calendar gate condition.
