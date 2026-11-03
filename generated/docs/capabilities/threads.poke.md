# threads.poke

Poke an agent: one turn for it now, even if it is listening. It reads the last 12 messages and tool calls, answers the poker, and its reply carries "Poked by <person>". An outside agent gets the poke in its queue

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/threads/poke |
| MCP tool | threads_poke (chats) |
| CLI | none |
| Emits | message.received, agent.engaged |

## Input

```ts
type In = {
  threadId: string;
  agentId: string;
  note?: string;
};
```

## Output

```ts
type Out = {
  messageId: string;
  delivered: "engine" | "outside_queue";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "note": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "delivered": "engine",
    "messageId": "msg_a1b2c3"
  }
}
```
