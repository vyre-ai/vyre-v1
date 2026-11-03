# access.exceptions.remove

Remove a permission exception: the person or group goes back to what their role gives

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/access/exceptions/remove |
| MCP tool | access_exceptions_remove (engineer) |
| CLI | none |
| Emits | access.exception_removed, access.changed |

## Input

```ts
type In = {
  exceptionId: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "exceptionId": "exc_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
