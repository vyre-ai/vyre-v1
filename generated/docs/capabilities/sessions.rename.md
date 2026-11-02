# sessions.rename

Give an imported session a new title in Vyre. Only the title shown changes: the copied transcript and its source provenance stay as they were

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | chats.private |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sessions/rename |
| MCP tool | sessions_rename (chats) |
| CLI | none |
| Emits | sessions.renamed |

## Input

```ts
type In = {
  conversationId: string;
  title: string;
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
    archived?: boolean;
  };
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
    "conversationId": "isc_a1b2c3",
    "title": "example"
  },
  "output": {
    "session": {
      "archived": true,
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
