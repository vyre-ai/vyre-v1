# health.services

Server services with state, uptime and restart count

| | |
|---|---|
| Module | health |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | server.services |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/health/services |
| MCP tool | health_services (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  services: Array<{
      name: string;
      state: "healthy" | "degraded" | "down";
      uptimeSeconds: number;
      restarts: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "services": [
      {
        "name": "example",
        "restarts": 1,
        "state": "healthy",
        "uptimeSeconds": 1
      }
    ]
  }
}
```
