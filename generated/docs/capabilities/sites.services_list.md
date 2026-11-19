# sites.services_list

A site's workers: processes of its image that stay up without a port (a queue consumer, a bot). A crashing one waits longer each time and stops for good after eight crashes in ten minutes

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/services_list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
};
```

## Output

```ts
type Out = {
  services: Array<{
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
    "siteId": "sit_a1b2c3"
  },
  "output": {
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
