# health.history

Samples of a health check over time

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
| HTTP | POST /v1/health/history |
| MCP tool | health_history (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key: string;
  sinceMs?: number;
};
```

## Output

```ts
type Out = {
  samples: Array<{
      at: number;
      state: "healthy" | "degraded" | "down";
      latencyMs?: number;
      detail?: string;
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
    "key": "example",
    "sinceMs": 1760000000000
  },
  "output": {
    "samples": [
      {
        "at": 1760000000000,
        "detail": "example",
        "latencyMs": 1,
        "state": "healthy"
      }
    ]
  }
}
```
