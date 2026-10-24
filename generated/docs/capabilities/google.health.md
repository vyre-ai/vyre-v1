# google.health

Health probe: mint a token for the probe user and call users.getProfile

| | |
|---|---|
| Module | google |
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
| HTTP | POST /v1/google/health |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  as?: string;
};
```

## Output

```ts
type Out = {
  state: "healthy" | "degraded" | "down";
  detail?: string;
  latencyMs?: number;
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
  "input": {
    "as": "maya@example.com"
  },
  "output": {
    "detail": "example",
    "latencyMs": 1,
    "state": "healthy"
  }
}
```
