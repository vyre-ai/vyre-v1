# sessions.get

Read an immutable imported session transcript owned by the signed-in person

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | chats.private |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sessions/get |
| MCP tool | sessions_get (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  conversationId: string;
};
```

## Output

```ts
type Out = {
  session: {
    conversationId: string;
    provider: "codex" | "claude_code";
    sourceKey: string;
    sourceSessionId: string;
    title: string;
    startedAt: number;
    importedAt: number;
    projectId?: string;
    continuedThreadId?: string;
  };
  messages: Array<{
      sourceMessageId: string;
      role: "user" | "assistant";
      text: string;
      at: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "conversationId": "isc_a1b2c3"
  },
  "output": {
    "messages": [
      {
        "at": 1760000000000,
        "role": "user",
        "sourceMessageId": "example",
        "text": "example"
      }
    ],
    "session": {
      "continuedThreadId": "thr_a1b2c3",
      "conversationId": "isc_a1b2c3",
      "importedAt": 1760000000000,
      "projectId": "prj_a1b2c3",
      "provider": "codex",
      "sourceKey": "example",
      "sourceSessionId": "example",
      "startedAt": 1760000000000,
      "title": "example"
    }
  }
}
```
