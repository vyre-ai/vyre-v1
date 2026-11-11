# computers.provision

Make an older-style desktop computer for an agent: a person only, an agent is refused (an agent has a terminal in its workspace and a browser in the Space browser already)

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.use |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/computers/provision |
| MCP tool | computers_provision (computer) |
| CLI | none |
| Emits | computer.provisioned |

## Input

```ts
type In = {
  agentId: string;
  tabLimit?: number;
  nodeId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  computer: {
    computerId: string;
    agentId: string;
    state: "provisioning" | "asleep" | "waking" | "working" | "takeover" | "error";
    caption?: string;
    tabs: number;
    tabLimit: number;
    host: "server" | "vm";
    nodeId?: string;
    diskBytes?: number;
    lastFrameAt?: number;
    lastActiveAt?: number;
    takeoverBy?: string;
    recording: boolean;
    error?: string;
    moved?: {
      state: "done" | "partial" | "failed";
      at: number;
      error?: string;
    };
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "idempotencyKey": "idem_1",
    "nodeId": "example",
    "tabLimit": 1
  },
  "output": {
    "computer": {
      "agentId": "agt_a1b2c3",
      "caption": "example",
      "computerId": "cmt_a1b2c3",
      "diskBytes": 1,
      "error": "example",
      "host": "server",
      "lastActiveAt": 1760000000000,
      "lastFrameAt": 1760000000000,
      "moved": {
        "at": 1760000000000,
        "error": "example",
        "state": "done"
      },
      "nodeId": "example",
      "recording": true,
      "state": "provisioning",
      "tabLimit": 1,
      "tabs": 1,
      "takeoverBy": "usr_a1b2c3"
    }
  }
}
```
