# sites.services

Workers of a site. action: list, add, restart, stop, remove

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/services |
| MCP tool | sites_services (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  action: "list" | "add" | "restart" | "stop" | "remove";
  serviceId?: string;
  name?: string;
  command?: string;
};
```

## Output

```ts
type Out = {
  services?: Array<{
      serviceId: string;
      siteId: string;
      name: string;
      kind: "worker" | "web";
      command: string;
      state: "stopped" | "starting" | "running" | "backoff" | "failed";
      note?: string;
      startedAt?: number;
      restartAt?: number;
    }>;
  service?: {
    serviceId: string;
    siteId: string;
    name: string;
    kind: "worker" | "web";
    command: string;
    state: "stopped" | "starting" | "running" | "backoff" | "failed";
    note?: string;
    startedAt?: number;
    restartAt?: number;
  };
  removed?: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
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
    "action": "list",
    "command": "example",
    "name": "example",
    "serviceId": "wkr_a1b2c3",
    "siteId": "sit_a1b2c3"
  },
  "output": {
    "removed": true,
    "service": {
      "command": "example",
      "kind": "worker",
      "name": "example",
      "note": "example",
      "restartAt": 1760000000000,
      "serviceId": "wkr_a1b2c3",
      "siteId": "sit_a1b2c3",
      "startedAt": 1760000000000,
      "state": "stopped"
    },
    "services": [
      {
        "command": "example",
        "kind": "worker",
        "name": "example",
        "note": "example",
        "restartAt": 1760000000000,
        "serviceId": "wkr_a1b2c3",
        "siteId": "sit_a1b2c3",
        "startedAt": 1760000000000,
        "state": "stopped"
      }
    ]
  }
}
```
