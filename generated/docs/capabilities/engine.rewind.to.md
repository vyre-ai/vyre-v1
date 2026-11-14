# engine.rewind.to

Put an agent's work folder back as it was at a point and have the agents stop reading the chat's messages from afterSeq to uptoSeq; the engine's own session starts again. The chat's messages are untouched. A person's own folder only; use chat.rewind, which also leaves the line in the chat

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/engine/rewind/to |
| MCP tool | engine_rewind_to (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  pointId: string;
  afterSeq: number;
  uptoSeq: number;
};
```

## Output

```ts
type Out = {
  agentId: string;
  at: number;
  restored: number;
  removed: number;
  undoPointId: string;
  undid: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "afterSeq": 1,
    "pointId": "example",
    "threadId": "thr_a1b2c3",
    "uptoSeq": 1
  },
  "output": {
    "agentId": "agt_a1b2c3",
    "at": 1760000000000,
    "removed": 1,
    "restored": 1,
    "undid": true,
    "undoPointId": "example"
  }
}
```
