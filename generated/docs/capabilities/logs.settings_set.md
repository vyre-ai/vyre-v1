# logs.settings_set

Change logging settings

| | |
|---|---|
| Module | logs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/logs/settings_set |
| MCP tool | logs_settings_set (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  level?: "debug" | "info" | "warn" | "error";
  fullDays?: number;
  aggregateDays?: number;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "aggregateDays": 1,
    "fullDays": 1,
    "level": "debug"
  },
  "output": {
    "ok": true
  }
}
```
