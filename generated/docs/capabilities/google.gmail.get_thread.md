# google.gmail.get_thread

Read a Gmail thread

| | |
|---|---|
| Module | google |
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
| HTTP | POST /v1/google/gmail/get_thread |
| MCP tool | google_gmail_get_thread (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  threadId: string;
};
```

## Output

```ts
type Out = {
  threadId: string;
  messages: Array<{
      id: string;
      threadId: string;
      labelIds: Array<string>;
      snippet?: string;
      historyId?: string;
      internalDate?: number;
      payload?: Record<string, unknown>;
    }>;
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
    "threadId": "example"
  },
  "output": {
    "messages": [
      {
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
    ],
    "threadId": "example"
  }
}
```
