# contacts.resolve

Find the contact or company that owns an email, phone or handle (sure and unsure matches)

| | |
|---|---|
| Module | contacts-link |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/contacts/resolve |
| MCP tool | contacts_resolve (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  email?: string;
  phone?: string;
  handle?: string;
  name?: string;
};
```

## Output

```ts
type Out = {
  sure: Array<{
      recordId: string;
      type: "contact" | "company";
      name: string;
      via: "address" | "phone" | "handle" | "name";
      score: number;
    }>;
  unsure: Array<{
      recordId: string;
      type: "contact" | "company";
      name: string;
      via: "address" | "phone" | "handle" | "name";
      score: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "email": "maya@example.com",
    "handle": "example",
    "name": "example",
    "phone": "+14155550123"
  },
  "output": {
    "sure": [
      {
        "name": "example",
        "recordId": "rec_a1b2c3",
        "score": 1,
        "type": "contact",
        "via": "address"
      }
    ],
    "unsure": [
      {
        "name": "example",
        "recordId": "rec_a1b2c3",
        "score": 1,
        "type": "contact",
        "via": "address"
      }
    ]
  }
}
```
