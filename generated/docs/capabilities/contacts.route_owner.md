# contacts.route_owner

Who receives an unowned reply: contact owner, then campaign owner, then the shared inbox

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
| HTTP | POST /v1/contacts/route_owner |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  contactId?: string;
  campaignId?: string;
  mailboxId?: string;
};
```

## Output

```ts
type Out = {
  ownerId?: string;
  via: "owner" | "campaign_owner" | "shared_inbox";
  mailboxId?: string;
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
    "campaignId": "cmp_a1b2c3",
    "contactId": "rec_a1b2c3",
    "mailboxId": "mbx_a1b2c3"
  },
  "output": {
    "mailboxId": "mbx_a1b2c3",
    "ownerId": "usr_a1b2c3",
    "via": "owner"
  }
}
```
