# sites.service_restart

Restart a worker now, clearing a crash loop that stopped it

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/service_restart |
| MCP tool | sites_service_restart (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  serviceId: string;
};
```

## Output

```ts
type Out = {
  service: {
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
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "serviceId": "wkr_a1b2c3",
    "siteId": "sit_a1b2c3"
  },
  "output": {
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
    }
  }
}
```
