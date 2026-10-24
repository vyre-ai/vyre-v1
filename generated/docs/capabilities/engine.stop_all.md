# engine.stop_all

Stop every agent working in a thread (Stop all in the conversation header)

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/stop_all |
| MCP tool | engine_stop_all (chats) |
| CLI | none |
| Emits | turn.cancelled |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  stopped: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "stopped": 1
  }
}
```
