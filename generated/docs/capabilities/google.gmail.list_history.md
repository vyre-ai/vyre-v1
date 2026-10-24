# google.gmail.list_history

Changes since a history id (cursor polling: 2 min active, 15 idle, 1 h dormant)

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
| HTTP | POST /v1/google/gmail/list_history |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  as?: string;
  startHistoryId: string;
  pageToken?: string;
};
```

## Output

```ts
type Out = {
  history: Array<{
      id: string;
      added: Array<string>;
      deleted: Array<string>;
      labelsChanged: Array<string>;
    }>;
  historyId: string;
  nextPageToken?: string;
  expired: boolean;
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
    "pageToken": "example",
    "startHistoryId": "example"
  },
  "output": {
    "expired": true,
    "history": [
      {
        "added": [
          "example"
        ],
        "deleted": [
          "example"
        ],
        "id": "example",
        "labelsChanged": [
          "example"
        ]
      }
    ],
    "historyId": "example",
    "nextPageToken": "example"
  }
}
```
