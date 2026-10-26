# computers.take_over

Take over the computer ("You're in control"); your actions become one "You took over" step

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.take_over |
| Grant level | use |
| Risk | medium |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | yes |
| HTTP | POST /v1/computers/take_over |
| MCP tool | computers_take_over (computer) |
| CLI | none |
| Emits | computer.takeover, computer.started |

## Input

```ts
type In = {
  computerId: string;
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
  ticket: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
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
    "computerId": "cmt_a1b2c3"
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
    },
    "ticket": "example"
  }
}
```
