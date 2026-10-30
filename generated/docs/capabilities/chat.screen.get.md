# chat.screen.get

The screen context the person sent with a message (or the latest in the thread): the place, open objects, selection, filters and a summary of visible rows

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chat/screen/get |
| MCP tool | chat_screen_get (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  messageId?: string;
};
```

## Output

```ts
type Out = {
  screen: {
    place: string;
    title?: string;
    open?: Array<{
        type: string;
        id: string;
        title?: string;
      }>;
    selection?: Array<{
        type: string;
        id: string;
        title?: string;
      }>;
    filters?: Record<string, unknown>;
    rows?: {
      shown: number;
      total?: number;
      sample?: Array<string>;
    };
    actions?: Array<string>;
    focus?: string;
  } | null;
  messageId?: string;
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
    "messageId": "msg_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "messageId": "msg_a1b2c3",
    "screen": {
      "actions": [
        "example"
      ],
      "filters": {},
      "focus": "example",
      "open": [
        {
          "id": "rec_a1b2c3",
          "title": "example",
          "type": "record"
        }
      ],
      "place": "records",
      "rows": {
        "sample": [
          "example"
        ],
        "shown": 1,
        "total": 1
      },
      "selection": [
        {
          "id": "rec_a1b2c3",
          "title": "example",
          "type": "record"
        }
      ],
      "title": "example"
    }
  }
}
```
