# google.gmail.modify_labels

Add or remove labels on a message in the member mailbox

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
| HTTP | POST /v1/google/gmail/modify_labels |
| MCP tool | google_gmail_modify_labels (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  messageId: string;
  add?: Array<string>;
  remove?: Array<string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  message: {
    id: string;
    threadId: string;
    labelIds: Array<string>;
    snippet?: string;
    historyId?: string;
    internalDate?: number;
    payload?: Record<string, unknown>;
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
    "add": [
      "example"
    ],
    "as": "maya@example.com",
    "connectionId": "con_a1b2c3",
    "idempotencyKey": "idem_1",
    "messageId": "example",
    "remove": [
      "example"
    ]
  },
  "output": {
    "message": {
      "historyId": "example",
      "id": "example",
      "internalDate": 1760000000000,
      "labelIds": [
        "example"
      ],
      "payload": {},
      "snippet": "example",
      "threadId": "example"
    }
  }
}
```
