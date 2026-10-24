# contacts.suppression.remove

Take an address off the suppression list (a person decision, audited)

| | |
|---|---|
| Module | contacts-link |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.delete |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/contacts/suppression/remove |
| MCP tool | contacts_suppression_remove (inbox) |
| CLI | none |
| Emits | suppression.removed |

## Input

```ts
type In = {
  suppressionId: string;
  note?: string;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "note": "example",
    "suppressionId": "sup_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
