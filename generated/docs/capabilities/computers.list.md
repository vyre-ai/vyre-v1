# computers.list

List agent computers with state, tabs, disk and last activity

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.watch |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/list |
| MCP tool | computers_list (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  state?: Array<"provisioning" | "asleep" | "waking" | "working" | "takeover" | "error">;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  computers: Array<{
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
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "state": [
      "provisioning"
    ]
  },
  "output": {
    "computers": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
