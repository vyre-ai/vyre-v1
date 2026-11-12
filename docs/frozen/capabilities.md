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

Signed: lead, 12 Nov 2026

## 12 Nov 2026: the Space browser's slots, reopen notice and member takeover (lane f-sbrowser)

Changed contracts, all in `manifests/computers.ts`; no capability was added or removed, and no version moved, because every change is an optional output field or a looser permission the handler still checks:

- `computers.browser.profiles@1`: the output gains an optional `slots { running, limit, waiting }`, for one quiet line in Console > Computers (how many browsers run on this server, how many it runs at once, how many calls wait for one). A tool refusal from the Space browser may now carry the reason `browser_full` (every browser on the server is in use; the call waited its turn and was not served within 5 minutes).
- Every `computers.chrome.*` tool except `batch`: the output gains optional `reopened` and `note`, set once on the first answer after the agent's browser was reopened (closed to make room, or stopped when idle) and its pages reloaded. An act on refs from a snapshot taken before is refused with the reason `browser_reopened` until a new snapshot.
- `computers.chrome.type@1` and `computers.chrome.send@1` gain the optional `downloads` output the other acting tools already had. In `downloads`, `fileId` is now optional and a `note` says why a download too large to move is not in Files.
- `computers.browser.take_over@1`, `give_back@1` and `sign_out@1` ask for `computers.watch` instead of `computers.take_over`. The Space browser's own rule still decides who may (sbrowser/policy.ts: a personal agent's browser is its owner's, a team agent's its owner's and the admins'), so a plain member can take over their own Assistant's browser. This was decided in the review round of 12 Nov (audit B6).

The lead signed the `slots` field and the `browser_full` reason. The other three items above are listed for the lead's sign-off.

Signed: lead, 12 Nov 2026 (slots on computers.browser.profiles, the browser_full reason)
