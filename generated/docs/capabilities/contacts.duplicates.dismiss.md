# contacts.duplicates.dismiss

Mark a suggested pair as not duplicates

| | |
|---|---|
| Module | contacts-link |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/contacts/duplicates/dismiss |
| MCP tool | contacts_duplicates_dismiss (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  suggestionId: string;
};
```

## Output

```ts
type Out = {
  dismissed: boolean;
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
    "suggestionId": "example"
  },
  "output": {
    "dismissed": true
  }
}
```
