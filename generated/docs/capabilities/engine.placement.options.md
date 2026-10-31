# engine.placement.options

What the runs-on chip of a chat offers: this computer, the Space in a Team Space and each of your servers, with whether each is on and why not; and where the chat runs now

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/placement/options |
| MCP tool | engine_placement_options (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  agentId?: string;
};
```

## Output

```ts
type Out = {
  private: boolean;
  effective: {
    target: "device" | "space" | "server";
    serverId?: string;
  };
  options: Array<{
      target: "device" | "space" | "server";
      serverId?: string;
      name: string;
      online: boolean;
      reason?: string;
    }>;
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
    "agentId": "agt_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "effective": {
      "serverId": "example",
      "target": "device"
    },
    "options": [
      {
        "name": "example",
        "online": true,
        "reason": "example",
        "serverId": "example",
        "target": "device"
      }
    ],
    "private": true
  }
}
```
