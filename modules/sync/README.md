# Sync module

The sync lane keeps `sync_rows` (the server's copy of each row) and `sync_changes` (the feed a device pulls). Rows arrive only from `record.*` events and from `sync.row` and `sync.row_rescan` events. Visibility is decided in `sync/src/server/pull/scope.ts`.

## Before anyone builds chat sync

No module emits `sync.row` for chat today (checked 4 Nov 2026 by listing every event a chat start, post and member add writes). `client/src/store/resolvers/chat.ts` reads `chat_message` from the replica, but nothing fills it, so the app falls back to the gateway call. Two things stand in the way of filling it.

1. Private chat rows are `enc` 2 and owner-only. `Viewer.sees` (scope.ts) sends an `enc` 2 row, or a `private` or `owner` row, only to its owner's devices. A person added to a private chat (owner ruling, 4 Nov 2026) would receive none of its rows by sync until group-chat sync is designed: either sealed to every member's key, or sent by another route.
2. Row visibility follows grants on the `thread` resource type, not chat membership. A producer that emits message rows under the grants as they are would show every private chat to anyone with a Space-wide view grant on `thread`. Chat sync needs a membership predicate (the chat root's `thread_member` rows) in the scope, before a single message row is emitted.

What is already in place for when chat sync is built:

- `MemberFloor` (scope.ts) holds back every `message` row made before a person's `fromAt` on the chat root's `thread_member` row, with its pins, reactions and attachments, in pull and snapshot. A thread under the chat answers to the chat's start.
- The person's starts are part of the pull's access stamp, so a start that moves or is lifted ("Include earlier messages") makes each of their devices re-check its rows on the next pull (`rescanChanged` in pull.ts).
- The producer must emit the `thread_member` row with `fromAt` (the manifest field exists), and the thread rows with `parentThreadId`.
- Tests: `modules/sync/tests/pull.floor.test.ts`.
