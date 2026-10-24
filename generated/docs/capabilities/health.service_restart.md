# health.service_restart

Restart a server service

| | |
|---|---|
| Module | health |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.services |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/health/service_restart |
| MCP tool | health_service_restart (engineer) |
| CLI | none |
| Emits | service.restarted |

## Input

```ts
type In = {
  service: string;
};
```

## Output

```ts
type Out = {
  state: "healthy" | "degraded" | "down";
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
  "input": {
    "service": "example"
  },
  "output": {
    "state": "healthy"
  }
}
```
