# health.run

Run one health check or all of them now

| | |
|---|---|
| Module | health |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | console.access |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/health/run |
| MCP tool | health_run (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key?: string;
};
```

## Output

```ts
type Out = {
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
  "input": {
    "key": "example"
  },
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
    ]
  }
}
```
