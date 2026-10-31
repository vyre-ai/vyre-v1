# google.user.send_message

Send a message from your own signed-in Gmail (mail.send_as uses it for a mailbox made by google.user.complete)

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/google/user/send_message |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  accountId: string;
  to: Array<string>;
  cc?: Array<string>;
  bcc?: Array<string>;
  subject: string;
  text?: string;
  html?: string;
  threadId?: string;
  attachments?: Array<string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  id: string;
  threadId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.rate_limited
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "accountId": "example",
    "attachments": [
      "fil_a1b2c3"
    ],
    "bcc": [
      "maya@example.com"
    ],
    "cc": [
      "maya@example.com"
    ],
    "html": "example",
    "idempotencyKey": "idem_1",
    "subject": "example",
    "text": "example",
    "threadId": "example",
    "to": [
      "maya@example.com"
    ]
  },
  "output": {
    "id": "example",
    "threadId": "example"
  }
}
```
