# sites.service_add

Add a worker to a deployed site: a command that stays up in the site's image, restarts itself on a crash, and moves to the newest deploy

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | sites.deploy |
| Grant level | edit |
| Risk | medium |
| Resource | site (/siteId) |
| Gate | send when sites.run_gate(input) |
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/sites/service_add |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  name: string;
  command: string;
  kind?: "worker";
  idempotencyKey: string;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "command": "node worker.js",
    "idempotencyKey": "idem_1",
    "kind": "worker",
    "name": "example",
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
