# health.time_skew

Probe: clock skew against the relay (HLC clamps at 5 minutes)

| | |
|---|---|
| Module | health |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/health/time_skew |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  state: "healthy" | "degraded" | "down";
  detail?: string;
  latencyMs?: number;
  skewMs?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "detail": "example",
    "latencyMs": 1,
    "skewMs": 1,
    "state": "healthy"
  }
}
```
