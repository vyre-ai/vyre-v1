# google.gmail.list_messages

Search or list Gmail messages

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
| HTTP | POST /v1/google/gmail/list_messages |
| MCP tool | google_gmail_list_messages (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  q?: string;
  labelIds?: Array<string>;
  maxResults?: number;
  pageToken?: string;
};
```

## Output

```ts
type Out = {
  messages: Array<{
      id: string;
      threadId: string;
    }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
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
    "labelIds": [
      "example"
    ],
    "maxResults": 1,
    "pageToken": "example",
    "q": "example"
  },
  "output": {
    "messages": [
      {
        "id": "example",
        "threadId": "example"
      }
    ],
    "nextPageToken": "example",
    "resultSizeEstimate": 1
  }
}
```
