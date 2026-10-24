# portal.post

Post into a record conversation or channel as the outside account; lands in the Inbox like any message

| | |
|---|---|
| Module | portal |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | record (create under /recordId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/portal/post |
| MCP tool | portal_post (sites) |
| CLI | none |
| Emits | portal.message_posted |

## Input

```ts
type In = {
  accountId: string;
  recordId: string;
  body: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  messageId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "accountId": "pac_a1b2c3",
    "body": "example",
    "idempotencyKey": "idem_1",
    "recordId": "rec_a1b2c3"
  },
  "output": {
    "messageId": "msg_a1b2c3"
  }
}
```
