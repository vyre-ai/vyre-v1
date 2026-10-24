# updates.app_compat

Which app versions this server supports (within 2 minor versions); older apps read-only

| | |
|---|---|
| Module | updates |
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
| HTTP | POST /v1/updates/app_compat |
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
  min: string;
  max: string;
  updateRequiredBelow: string;
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
    "max": "1.0.0",
    "min": "1.0.0",
    "updateRequiredBelow": "1.0.0"
  }
}
```
