# contacts.deliverability

Deliverability badge of a contact: good, risky, bounced or complained

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
| HTTP | POST /v1/contacts/deliverability |
| MCP tool | contacts_deliverability (inbox) |
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
  state: "good" | "risky" | "bounced" | "complained";
  lastEventAt?: number;
  reasons: Array<string>;
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
    "lastEventAt": 1760000000000,
    "reasons": [
      "example"
    ],
    "state": "good"
  }
}
```
