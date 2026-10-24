# health.status

Latest state of every health check, grouped by module

| | |
|---|---|
| Module | health |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | console.access |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/health/status |
| MCP tool | health_status (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  overall: "healthy" | "degraded" | "down";
  checks: Array<{
      key: string;
      title: string;
      state: "healthy" | "degraded" | "down";
      detail?: string;
      checkedAt: number;
      module: string;
      next: string;
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
    "checks": [
      {
        "checkedAt": 1760000000000,
        "detail": "example",
        "key": "example",
        "module": "example",
        "next": "example",
        "state": "healthy",
        "title": "example"
      }
    ],
    "overall": "healthy"
  }
}
```
