# contacts.address.list

List every email, phone and handle held by a contact

| | |
|---|---|
| Module | contacts-link |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/contactId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/contacts/address/list |
| MCP tool | contacts_address_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  contactId: string;
};
```

## Output

```ts
type Out = {
  addresses: Array<{
      id: string;
      contactId: string;
      kind: "email" | "phone" | "handle";
      value: string;
      primary: boolean;
      verified: boolean;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "contactId": "rec_a1b2c3"
  },
  "output": {
    "addresses": [
      {
        "contactId": "rec_a1b2c3",
        "id": "adr_a1b2c3",
        "kind": "email",
        "primary": true,
        "value": "example",
        "verified": true
      }
    ]
  }
}
```
