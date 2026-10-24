# contacts.address.remove

Remove an email, phone or handle from a contact

| | |
|---|---|
| Module | contacts-link |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record (/contactId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/contacts/address/remove |
| MCP tool | contacts_address_remove (inbox) |
| CLI | none |
| Emits | contact.address_removed |

## Input

```ts
type In = {
  contactId: string;
  addressId: string;
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
    "addressId": "adr_a1b2c3",
    "contactId": "rec_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
