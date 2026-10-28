# sessions.list

List the current owner private imported session archive in this Personal Space

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
| HTTP | POST /v1/sessions/list |
| MCP tool | sessions_list (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  sessions: Array<{
      conversationId: string;
      provider: "codex" | "claude_code";
      sourceKey: string;
      sourceSessionId: string;
      title: string;
      startedAt: number;
      importedAt: number;
      projectId?: string;
      continuedThreadId?: string;
    }>;
  next?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "next": "example",
    "sessions": [
      {
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
    ]
  }
}
```
