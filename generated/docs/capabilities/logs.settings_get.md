# logs.settings_get

Logging settings: levels, retention windows, review sampling

| | |
|---|---|
| Module | logs |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | server.logs |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/logs/settings_get |
| MCP tool | logs_settings_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  level: "debug" | "info" | "warn" | "error";
  fullDays: number;
  aggregateDays: number;
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
    "aggregateDays": 1,
    "fullDays": 1,
    "level": "debug"
  }
}
```
