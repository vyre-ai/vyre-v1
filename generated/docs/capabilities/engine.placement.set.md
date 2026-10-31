# engine.placement.set

Pin a private chat to where it runs: this computer, the Space (Team Space), or one of your own servers. The next turn goes there; a teammate's machine is never a choice

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/placement/set |
| MCP tool | engine_placement_set (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  target: "device" | "space" | "server";
  serverId?: string;
};
```

## Output

```ts
type Out = {
  target: "device" | "space" | "server";
  serverId?: string;
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
    "serverId": "example",
    "target": "device",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "serverId": "example",
    "target": "device"
  }
}
```
