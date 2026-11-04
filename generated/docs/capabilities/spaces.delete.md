# spaces.delete

Owner only: schedule the Space for deletion 14 days out after typing its legal name. Needs an export from the last 24 hours, or withoutExport. Everything keeps working until the date

| | |
|---|---|
| Module | spaces |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/spaces/delete |
| MCP tool | spaces_delete (meta) |
| CLI | none |
| Emits | space.deletion_scheduled |

## Input

```ts
type In = {
  confirmName: string;
  withoutExport?: boolean;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  deletionAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "confirmName": "example",
    "withoutExport": true
  },
  "output": {
    "deletionAt": 1760000000000,
    "ok": true
  }
}
```
