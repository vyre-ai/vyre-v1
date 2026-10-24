# ms.mail.list_messages

List or search messages

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
| HTTP | POST /v1/ms/mail/list_messages |
| MCP tool | ms_mail_list_messages (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  folderId?: string;
  search?: string;
  top?: number;
  skipToken?: string;
};
```

## Output

```ts
type Out = {
  messages: Array<{
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
    }>;
  nextSkipToken?: string;
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
    "folderId": "example",
    "search": "example",
    "skipToken": "example",
    "top": 1
  },
  "output": {
    "messages": [
      {
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
    ],
    "nextSkipToken": "example"
  }
}
```
