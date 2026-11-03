# access.exceptions.lapse

The server ends a permission exception whose end has come (the periodic job); audited

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/access/exceptions/lapse |
| MCP tool | none |
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
