# computers.provision

Give an agent a computer (none unless the agent needs one)

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
| Team Space only | yes |
| HTTP | POST /v1/computers/provision |
| MCP tool | computers_provision (computer) |
| CLI | none |
| Emits | computer.provisioned |

## Input

```ts
type In = {
  agentId: string;
  tabLimit?: number;
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
    diskBytes?: number;
    lastFrameAt?: number;
    lastActiveAt?: number;
    takeoverBy?: string;
    recording: boolean;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
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
    "tabLimit": 1
  },
  "output": {
    "computer": {
      "agentId": "agt_a1b2c3",
      "caption": "example",
      "computerId": "cmt_a1b2c3",
      "diskBytes": 1,
      "host": "server",
      "lastActiveAt": 1760000000000,
      "lastFrameAt": 1760000000000,
      "recording": true,
      "state": "provisioning",
      "tabLimit": 1,
      "tabs": 1,
      "takeoverBy": "usr_a1b2c3"
    }
  }
}
```
