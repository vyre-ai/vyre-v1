# Frozen capabilities (Freeze review A, P-PR_34)

Review of the merged capability registry at the F11 freeze. `packages/contracts/tests/frozen-capabilities.test.ts` checks the rules in this file and the snapshots it describes. A deliberate change to the registry updates this file in the same commit, signed by the lead.

## Frozen values

The contract of every capability is frozen in `docs/frozen/snapshots/<manifest>.json`: one small file per manifest, one line per capability (`name@version`) holding the sha256 of its canonical definition with shared schemas resolved (`lib/snapshot.ts`). The regen bot writes the files with `node tools/gen/src/cli.ts --snapshots`; the test fails on a missing, changed or stray file and names the capability. There is no registry-wide hash, count or per-lane table here on purpose: each of those changed with every contract change, so every contract PR conflicted with every other. Two PRs that change different manifests now merge in either order with nothing to re-record.

## Completeness (all capabilities, checked by the test)

- Every capability has an input schema, an output schema, at least one example, at least one declared error, an effects value (read, write or outward) and a level.
- Permission is a catalogue key or null (grant-only); both are valid, null means the grant level alone decides.
- Every outward capability has a gate; 47 of them use `gate.act = none` and each of those carries a written reason.
- Every capability with idempotency `key` has an `idempotencyKey` in its input (through `$ref` where the schema is shared).
- Every capability has exactly one example, so no capability is unexemplified.

## Sample read at the freeze

At the F11 freeze the lead read 10 percent of each lane's capabilities (sorted by name, every n-th). The findings below come from that read. The sample lists are not kept: they went stale with the first contract change and the completeness rules above are what the test enforces.

## Findings from reading the sample

Nothing blocks the freeze. The sample read cleanly: summaries match the declared effects, outward capabilities carry gates that match their risk (send, post, pay, delete, push_protected), and error lists are non-empty with permission codes on guarded calls. Points for the owning lane to confirm before its first build packet, none of which change a count or the hash:

- L7a writes with level `view` and no permission (`devices.revoke`, `spaces.leave`, `stars.toggle`, `identity.totp_begin`, `identity.passkey_remove`) act on the caller's own objects. Confirm the resource binding resolves to the caller, so the grant check cannot be satisfied by another person's object.
- `access.requests.decline` has no permission and level `view`. Confirm the handler requires the request's approver, since the registry alone does not.
- `governance.tombstones.reapply` is described as a system call and has no permission. Confirm its caller restriction or keep it out of the HTTP and MCP surfaces.
- `runs.undo` has risk `high` and no gate. Undo replays inverse writes, so confirm it never reverses an outward effect (the preview capability `runs.preview_undo` says what it cannot undo).
- 39 capabilities carry a gate while their effects are `write`, for example `mail.domain.remove` and `network.server_remove` (gate `delete`). This is intended: the gate applies to destructive inward writes too.



## 12 Nov 2026: threads.remove_agent is audited always (lane f-revoke)

`threads.remove_agent@1` now has `audit: 'always'`, as `threads.outside_agent.remove` has. Nothing else in its contract changed: same input, output, level, permission, events and errors. Why: since the f-revoke round, taking an agent out of a chat also takes back, as the host, every grant that chat gave it, whoever gave it; the Console's audit log must show who took that access away, as it already does for an outside agent. Snapshot: docs/frozen/snapshots/chat.json, regenerated with `node tools/gen/src/cli.ts --snapshots`.

## 12 Nov 2026: the computer tools bind to the calling agent when the id is left out

- What changed: the resource binding of the 22 `computers.chrome.*` tools, the 8 `computers.screen.*` tools and the 5 `computers.files.*` tools on an agent's computer gains `self: 'agent'` (`local()` in `manifests/computers.ts`, `orSelf: true`). An agent that leaves `computerId` out is bound to its own computer or Space browser. No input, output, permission, level or error changed; only `docs/frozen/snapshots/computers.json` moved.
- Why: every real agent call that left the optional id out was refused before its handler ("/computerId: the id is missing") in rc.24 and rc.25, so an agent could not use its own browser or computer without naming it.
- What the gateway does with such a call (`host/src/routes/resource.ts`): the chat answer check and the audit row name what it reaches (the asker's own Chrome, the agent's browser profile, or the agent's own computer), the handler asks `computers.use` on the agent's computer, and a person who leaves the id out is told to pass it.

Signed: lead, 12 Nov 2026

## 12 Nov 2026: access.grants.update may emit grant.revoked, and access.unshare may emit grant.updated (lane f-revoke)

12 Nov 2026: access.grants.update may emit grant.revoked and access.unshare may emit grant.updated, because a record share's folder copy follows in the same call (lane f-revoke). Lowering a share on a record drops its copy on the record's folder when the person keeps no level there (`grant.revoked`), and taking one of several record shares away lowers the copy to what is left (`grant.updated`). Nothing else in either contract changed: same input, output, level, permission and errors; the events carry their own declared payloads.

Signed: lead, 12 Nov 2026

## 12 Nov 2026: the Space browser's slots, reopen notice and member takeover (lane f-sbrowser)

Changed contracts, all in `manifests/computers.ts`; no capability was added or removed, and no version moved, because every change is an optional output field or a looser permission the handler still checks:

- `computers.browser.profiles@1`: the output gains an optional `slots { running, limit, waiting }`, for one quiet line in Console > Computers (how many browsers run on this server, how many it runs at once, how many calls wait for one). A tool refusal from the Space browser may now carry the reason `browser_full` (every browser on the server is in use; the call waited its turn and was not served within 5 minutes).
- Every `computers.chrome.*` tool except `batch`: the output gains optional `reopened` and `note`, set once on the first answer after the agent's browser was reopened (closed to make room, or stopped when idle) and its pages reloaded. An act on refs from a snapshot taken before is refused with the reason `browser_reopened` until a new snapshot.
- `computers.chrome.type@1` and `computers.chrome.send@1` gain the optional `downloads` output the other acting tools already had. In `downloads`, `fileId` is now optional and a `note` says why a download too large to move is not in Files.
- `computers.browser.take_over@1`, `give_back@1` and `sign_out@1` ask for `computers.watch` instead of `computers.take_over`. The Space browser's own rule still decides who may (sbrowser/policy.ts: a personal agent's browser is its owner's, a team agent's its owner's and the admins'), so a plain member can take over their own Assistant's browser. This was decided in the review round of 12 Nov (audit B6).

One consequence, called out by the reviewer: the `computers.take_over` role toggle no longer governs taking over an agent's Space browser. The browser's own policy does: its owner, and the admins for a team agent. The toggle still governs agent computers (the app's Computer tab gates Take over on it, and the catalogue calls it "Take over an agent computer"); no screen shows it as governing browsers.

Signed: lead, 12 Nov 2026 (all of the above: slots, browser_full, reopened and note on chrome outputs, downloads on type and send with fileId optional and a note, take_over, give_back and sign_out on computers.watch with the browser's policy deciding)

Added on the reviewer's seventh look and signed below: `computers.browser.take_over@1` gains an optional output `note`, one line for the pane when the browser was reopened since the person last saw it and its page was reloaded; and acts on the page (`click`, `act`, `type`, `fill`, `send`, `api`, `eval`) may now be refused with the reason `browser_reopened` until the agent has seen the reloaded page.

Signed: lead, 12 Nov 2026 (the optional note on computers.browser.take_over, and the browser_reopened refusal on acts)

## 12 Nov 2026: notifications.send narrows the agent tool's kinds (lane f-notify, paragraph added by lane f-trust)

The hash of `notifications.send@1` changed from 4274fa4300adf0432f0d36182549c6e83f4df16f52880bc20ca874d66fd9f1d0 to 7e92d4bebba03ae2536cbd528ddb29d7d150d12ba8cd75ed70ae70df6a62490d in commit 9bc1392c8. The manifest gained `surfaces.agent.only`, a generator option that cuts one enum on the agent's tool only: an agent may send only the kinds about it talking to someone (dm, mention, item.shared, agent.task_finished). The capability itself is unchanged: the same input, output, level, permission, events and errors, and module code still sends every kind. Why: the other kinds come from Vyre and its modules, so the agent's tool should not offer them; the server refuses them anyway (SENDABLE_KINDS in modules/notifications/handlers/rules.ts). The lane f-trust change that makes a forwarded call (a stored schedule, a template step, a Kit step) count as its caller's own call touches no manifest and no snapshot. Snapshot: docs/frozen/snapshots/notifications.json, regenerated with `node tools/gen/src/cli.ts --snapshots`.

Signed: lead, 12 Nov 2026
