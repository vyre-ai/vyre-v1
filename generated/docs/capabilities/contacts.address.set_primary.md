# contacts.address.set_primary

Make one address the primary email or phone of a contact

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
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/contacts/address/set_primary |
| MCP tool | contacts_address_set_primary (inbox) |
| CLI | none |
| Emits | none |

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
  address: {
    id: string;
    contactId: string;
    kind: "email" | "phone" | "handle";
    value: string;
    primary: boolean;
    verified: boolean;
  };
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
    "address": {
      "contactId": "rec_a1b2c3",
      "id": "adr_a1b2c3",
      "kind": "email",
      "primary": true,
      "value": "example",
      "verified": true
    }
  }
}
```
