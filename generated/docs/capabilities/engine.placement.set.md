# engine.placement.set

Choose where a private chat runs: one of your computers, the Space, one of your own servers, or auto. Never a teammate's machine. once with space runs the next turn on the Space once

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
  target: "auto" | "device" | "space" | "server";
  serverId?: string;
  deviceId?: string;
  once?: boolean;
};
```

## Output

```ts
type Out = {
  target: "auto" | "device" | "space" | "server";
  serverId?: string;
  deviceId?: string;
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
    "deviceId": "example",
    "once": true,
    "serverId": "example",
    "target": "auto",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "deviceId": "example",
    "serverId": "example",
    "target": "auto"
  }
}
```
