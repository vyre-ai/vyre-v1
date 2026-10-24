# google.gmail.create_draft

Create a draft in the member mailbox

| | |
|---|---|
| Module | google |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/google/gmail/create_draft |
| MCP tool | google_gmail_create_draft (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  to: Array<string>;
  subject: string;
  text?: string;
  html?: string;
  threadId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  draftId: string;
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
    "draftId": "example"
  }
}
```
