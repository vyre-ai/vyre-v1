# ms.mail.move_message

Move a message to another folder

| | |
|---|---|
| Module | microsoft |
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
| HTTP | POST /v1/ms/mail/move_message |
| MCP tool | ms_mail_move_message (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  messageId: string;
  folderId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  message: {
    id: string;
    conversationId?: string;
    subject?: string;
    bodyPreview?: string;
    receivedDateTime?: string;
    isRead?: boolean;
    from?: Record<string, unknown>;
    toRecipients?: Array<Record<string, unknown>>;
    categories?: Array<string>;
    parentFolderId?: string;
  };
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
    "folderId": "example",
    "idempotencyKey": "idem_1",
    "messageId": "example"
  },
  "output": {
    "message": {
      "bodyPreview": "example",
      "categories": [
        "example"
      ],
      "conversationId": "example",
      "from": {},
      "id": "example",
      "isRead": true,
      "parentFolderId": "example",
      "receivedDateTime": "example",
      "subject": "example",
      "toRecipients": [
        {}
      ]
    }
  }
}
```
