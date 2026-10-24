# Vyre Console: system design (binding brief)

The console is the control plane for one Space. It runs on the Space's own server, at console.<space-address>, for Owners, Admins and Developers. The app is the data plane: work happens there, structure and policy are set here. Every console screen is a view over a small set of primitives. Build from the primitives, not from pages.

## 1. Primitives

| Primitive | What it is | Key fields |
|---|---|---|
| Principal | Anything that can act. Four kinds: Person, Agent, Outside actor (a registered external agent or tool: Claude Code on a laptop, Codex), Service (a connector or webhook identity). | id, kind, name, owner (for agents, actors, services), status |
| Group | A named set of principals (people and agents). One level, no nesting. Used to grant access to many at once. | id, name, members, managers |
| Role | A named bundle of permissions at Space scope. Built-in: Owner, Admin, Developer, Member, Guest. Custom roles are created here, often by cloning. A principal or group holds one or more roles. Agents may hold roles except Owner and Admin. | id, name, permissions[], clearance (highest sensitivity label), assignable to agents (y/n) |
| Permission | A verb on a resource type, from a fixed catalogue (section 2). Roles are sets of these. | key, area, description, risk (low/med/high) |
| Resource | Anything access applies to. Space-level types (record type, project, folder, channel, inbox, vault folder, automation group, agent, connector) and the items inside them. | type, id, label (sensitivity), owner |
| Grant | Access on one resource (or a whole resource type) for a principal, group or role, at an access level, with optional conditions. Grants flow down: a grant on a folder covers its files, on a record type covers its records. | subject, resource, level (View, Use, Edit, Manage), conditions, expires, granted by |
| Condition | A limit on a grant: a row filter ("records where Owner is me", "Region is West"), hidden fields, a label ceiling, a time window, an expiry. | kind, value |
| Sensitivity label | Public, Internal, Confidential, Restricted. On record types, fields, folders, channels, inboxes. A role's clearance caps what its holders can open, whatever the grants say. Labels also decide which AI providers may receive the data and whether it may sync to a laptop. | name, rank, rules |
| Policy | A Space-wide rule that applies to principals by kind or role: Gate rules (which outward actions need approval, by whom), spend limits, model allow-lists by label, retention per data kind, sign-in rules, sharing outside the Space. | key, scope, value |
| Session and device | A signed-in device of a person, or a run of an agent. | principal, device, last seen, location, revoke |
| Audit event | Every change to the above and every sensitive act (reveal, send, export, erase, admin change, Engineer MCP call). Append-only. | at, actor, on-behalf-of, action, resource, before/after (never secret values) |

## 2. Permission catalogue (the matrix rows)

Group by area. Each has a risk level shown as a dot. (Keys in brackets.)
- Space: invite people (members.invite), remove people (members.remove), manage roles and groups (access.manage), manage policies (policy.manage), read audit log (audit.read), open the console (console.access), use Engineer MCP (engineer.mcp).
- Records: create records (records.create), edit records (records.edit), delete records (records.delete), export (records.export), manage record types (schema.manage), reveal sealed fields (records.reveal), place holds (records.hold).
- Files: upload (files.write), delete (files.delete), share outside the Space (files.share_external).
- Chats and channels: create channels (channels.create), invite agents to channels (channels.agents), start private chats (chats.private).
- Agents: create agents (agents.create), change any agent (agents.manage), run agents on a schedule (agents.schedule), use agent computers (computers.use).
- Automations: create personal automations (automations.personal), create Space automations (automations.space), launch campaigns (campaigns.launch), design Journeys (journeys.manage).
- Comms: send from shared inboxes (comms.shared_send), send outside from agents (comms.agent_send), assign numbers (comms.numbers), manage sending domains (comms.domains).
- Vault: create shared items (vault.shared_create), reveal shared values (vault.reveal), export secrets as .env (vault.export, high risk; injection needs only Use), manage vault policy (vault.policy).
- AI: choose models beyond the defaults (ai.models), raise spend limits (ai.spend), review AI incidents (ai.incidents).
- Server: run updates (server.update), read logs and diagnostics (server.logs), restart services (server.services), manage backups and restore (server.backups), manage network (server.network).

Built-in roles fill this matrix with sensible defaults: Owner all; Admin all but transfer ownership and delete Space; Developer console access, Engineer MCP, schema, connectors, logs, no people management; Member the app's everyday verbs; Guest view and comment within explicit grants only.

## 3. How access is decided (one evaluation, explainable)

Can principal P do action A on resource R?
1. P's roles must include the permission for A (union over P's roles and its groups' roles).
2. There must be a grant on R (or an ancestor) to P, one of its groups, or one of its roles, at a level that includes A, whose conditions match (row filter, hidden fields, expiry, time).
3. R's sensitivity label must be within P's clearance (highest clearance among P's roles).
4. Policies apply last: Gate (needs approval), limits (spend), label rules (provider, laptop sync).
5. Agents: an agent acting for a person gets the intersection of its own access and that person's. A scheduled agent run acts with the agent's access intersected with its owner's. No agent ever gains access through a person it isn't acting for.
6. Owners of a resource always have Manage on it unless a hold or a label above their clearance blocks it.
Deny wins only through clearance and holds; there are no explicit deny grants (they make systems unreadable).
The console has an Access checker that runs this for any P, A, R and shows each step's result in plain words: "Omar can edit Rivera engagement: Member role allows editing records; Projects grant to the Delivery group (Edit); label Confidential within Member clearance."

## 4. Console information architecture

Top bar: Space mark and name, "Console", health dot, Cmd-K (pages, objects, actions), the Assistant toggle (Cmd-J), skin, "Open the app", the admin.
Left nav, five groups:
- Overview: health, attention items, recent admin activity, usage at a glance.
- Access: People, Groups, Roles, Grants (where access is given, by resource), Policies, Access checker, Access reviews, Sessions and devices.
- Agents and actors: Agents (the register), Outside actors, Agent computers, Agent template.
- Data: Schema (record types, including the record type under each Journey; fields, labels per field). Journeys themselves (stages, tasks, stage automations) are built in the app's Automations by roles with journeys.manage, Sensitivity labels, Retention, Holds, Erase a person, Backups, Export.
- AI: Models and providers, Gate rules, Spend and limits, Logging, Review sampling, Incidents, AI use policy.
- Comms: Sending domains, Numbers, Shared inboxes, Texting registration.
- Integrations: Connectors, Connections, Webhooks, API keys.
- Infrastructure: Network (domain, certificate, relay, nodes), Server (updates, logs, diagnostics, services, support bundle).
- Audit log.
- Space: identity, legal name, logo, defaults, danger zone.

Every object type gets the same three views: a list (search, filter menu, bulk actions), an object page (header with name, kind, owner, status and actions; tabs: Overview, Access, Activity, plus object-specific tabs), and a side sheet for quick edits. Examples:
- Person page: roles, groups, effective permissions (computed), grants they hold, agents and resources they own, devices and sessions, audit trail; actions Change roles, Reset password, Suspend, Remove (wizard).
- Role page: Permissions (the matrix column for this role, grouped, with risk dots and a diff since last change), Holders (people, agents, groups), Clearance, Where it is granted, Activity. Actions Clone, Rename, Delete (blocked while held; shows holders).
- Roles list page: the full permission matrix, permissions as rows grouped by area, roles as columns, checkboxes; built-in columns locked except clone; changes stage as a diff with "Apply changes" showing who gains and loses what.
- Group page: members (people and agents), managers, roles held, grants given to the group, activity.
- Resource access (from Grants, or from any record type, folder, channel, inbox): who has access, at what level, through what (direct, group, role), conditions, expiry; Add grant sheet.

## 5. Console Assistant

A right pane on every console page with your assistant and the Engineer MCP (Owners, Admins, Developers). It sees the page you are on as context. It proposes changes as a diff card (roles, grants, schema, policy, settings) with Apply, and every applied change is in the audit log with "on behalf of". It can explain access ("why can Omar see Rivera?"), draft a custom role from a sentence, build a record type, find and fix a failing diagnostic, connect another server.

## 6. Design bar

Linear/Vercel/Cloudflare-grade admin: dense but calm tables, a strong object model, no explaining sentences, every row has click, right-click (real actions), hover, keyboard; filter menus with checkmarks (no pills); destructive actions show impact (who gains or loses what) before confirm and have Undo where possible; consistent object headers; empty states that say what to do in one line; numbers aligned; status as small dots and words. Light and dark via v1/skins.js tokens.
