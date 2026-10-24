# ms.mail.delta

Changes in a mail folder since a delta link (fallback when change notifications are missed)

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
| HTTP | POST /v1/ms/mail/delta |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  folderId: string;
  deltaLink?: string;
};
```

## Output

```ts
type Out = {
  changed: Array<{
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
  removed: Array<string>;
  deltaLink: string;
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
    "deltaLink": "example",
    "folderId": "example"
  },
  "output": {
    "changed": [
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
    "deltaLink": "example",
    "removed": [
      "example"
    ]
  }
}
```
