# contacts.address.add

Add an email, phone or handle to a contact

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
| Idempotency | key |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/contacts/address/add |
| MCP tool | contacts_address_add (inbox) |
| CLI | none |
| Emits | contact.address_added |

## Input

```ts
type In = {
  contactId: string;
  kind: "email" | "phone" | "handle";
  value: string;
  primary?: boolean;
  idempotencyKey: string;
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
- validation.duplicate
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "contactId": "rec_a1b2c3",
    "idempotencyKey": "idem_1",
    "kind": "email",
    "primary": true,
    "value": "maya@example.com"
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
