# computers.get

Read one agent computer: state, caption, tabs, disk and who took over

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.watch |
| Grant level | view |
| Risk | low |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/get |
| MCP tool | computers_get (computer) |
| CLI | none |
| Emits | none |

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
    }
  }
}
```
