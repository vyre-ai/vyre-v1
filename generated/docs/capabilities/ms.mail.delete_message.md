# ms.mail.delete_message

Delete a message (moves it to Deleted Items)

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | connection (/connectionId) |
| Gate | delete |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/ms/mail/delete_message |
| MCP tool | ms_mail_delete_message (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  messageId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "idempotencyKey": "idem_1",
    "messageId": "example"
  },
  "output": {
    "deleted": true
  }
}
```
