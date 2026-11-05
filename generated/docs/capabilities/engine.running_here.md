# engine.running_here

System: the turns running now with the chat each is in and who asked, for the desktop update screen to name the reply it waits for and to end it (host/src/daemon, GET /local/daemon/busy)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | console.access |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/running_here |
| MCP tool | engine_running_here (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  turns: Array<{
      threadId: string;
      agentId: string;
      asker: string;
      turnId?: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "turns": [
      {
        "agentId": "agt_a1b2c3",
        "asker": "example",
        "threadId": "thr_a1b2c3",
        "turnId": "trn_a1b2c3"
      }
    ]
  }
}
```
