# engine.rewind.to

Put your own agent work folder back to one of your points and fold the chat's messages from that point's message on out of what the agents read. Never while that agent works. Use chat.rewind, which also leaves the line

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
};
```

## Output

```ts
type Out = {
  agentId: string;
  at: number;
  restored: number;
  removed: number;
  failed: number;
  failedPaths: Array<string>;
  undoPointId: string;
  undid: boolean;
  during: boolean;
  afterSeq: number;
  uptoSeq: number;
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
    "pointId": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "afterSeq": 1,
    "agentId": "agt_a1b2c3",
    "at": 1760000000000,
    "during": true,
    "failed": 1,
    "failedPaths": [
      "example"
    ],
    "removed": 1,
    "restored": 1,
    "undid": true,
    "undoPointId": "example",
    "uptoSeq": 1
  }
}
```
