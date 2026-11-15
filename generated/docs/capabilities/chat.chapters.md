# chat.chapters

The chapters of a long chat: where each starts (a Fresh context line, a gap of 3 hours, or 80 messages), its title and one line of what it settled. Empty for a chat of 40 messages or fewer. Worked out from the messages on every read

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
| HTTP | POST /v1/chat/chapters |
| MCP tool | chat_chapters (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  chapters: Array<{
      startSeq: number;
      startMsg: string;
      endSeq: number;
      startAt: number;
      count: number;
      current: boolean;
      title: string;
      summary: string;
      by: "extract" | "model" | "person";
    }>;
  wanted: number;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "chapters": [
      {
        "by": "extract",
        "count": 1,
        "current": true,
        "endSeq": 1,
        "startAt": 1760000000000,
        "startMsg": "msg_a1b2c3",
        "startSeq": 1,
        "summary": "example",
        "title": "example"
      }
    ],
    "wanted": 1
  }
}
```
