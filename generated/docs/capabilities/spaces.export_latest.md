# spaces.export_latest

When the newest finished export of this Space was taken, or nothing when none was; Delete this Space asks for one from the last 24 hours

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | records.export |
| Grant level | manage |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/spaces/export_latest |
| MCP tool | spaces_export_latest (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  at?: number;
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
    "at": 1760000000000
  }
}
```
