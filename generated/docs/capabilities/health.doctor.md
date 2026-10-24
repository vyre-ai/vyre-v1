# health.doctor

Doctor results: each check with a plain next step; same output as `vyre-server doctor`

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
| HTTP | POST /v1/health/doctor |
| MCP tool | health_doctor (engineer) |
| CLI | vyre doctor |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  ok: boolean;
  findings: Array<{
      key: string;
      state: "healthy" | "degraded" | "down";
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
    "findings": [
      {
        "key": "example",
        "next": "example",
        "state": "healthy"
      }
    ],
    "ok": true
  }
}
```
