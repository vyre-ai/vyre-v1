# ms.mail.get_message

Read one message

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/ms/mail/get_message |
| MCP tool | ms_mail_get_message (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  messageId: string;
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
  body?: string;
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
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "messageId": "example"
  },
  "output": {
    "body": "example",
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
