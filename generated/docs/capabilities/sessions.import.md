# sessions.import

Copy previewed local Codex or Claude Code sessions into immutable owner-private Vyre conversations; provider adapters supply only visible user and assistant text

| | |
|---|---|
| Module | import |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | chats.private |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sessions/import |
| MCP tool | sessions_import (chats) |
| CLI | none |
| Emits | sessions.imported |

## Input

```ts
type In = {
  provider: "codex" | "claude_code";
  sourceKey: string;
  consent: {
    previewedAt: number;
    confirmedAt: number;
  };
  destination?: {
    kind: "personal" | "team";
    confirmedAt?: number;
  };
  sessions: Array<{
      sourceSessionId: string;
      title?: string;
      startedAt: number;
      repo?: {
        remote?: string;
        root?: string;
      };
      messages: Array<{
          sourceMessageId: string;
          role: "user" | "assistant";
          text: string;
          at: number;
        }>;
    }>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  imported: number;
  updated: number;
  sessions: Array<{
      conversationId: string;
      provider: "codex" | "claude_code";
      destination: {
        kind: "project" | "imported_sessions";
        projectId?: string;
        scope: "personal" | "team";
      };
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "consent": {
      "confirmedAt": 1760000000000,
      "previewedAt": 1760000000000
    },
    "destination": {
      "confirmedAt": 1760000000000,
      "kind": "personal"
    },
    "idempotencyKey": "idem_1",
    "provider": "codex",
    "sessions": [
      {
        "messages": [
          {
            "at": 1760000000000,
            "role": "user",
            "sourceMessageId": "example",
            "text": "example"
          }
        ],
        "repo": {
          "remote": "example",
          "root": "example"
        },
        "sourceSessionId": "example",
        "startedAt": 1760000000000,
        "title": "example"
      }
    ],
    "sourceKey": "example"
  },
  "output": {
    "imported": 1,
    "sessions": [
      {
        "conversationId": "isc_a1b2c3",
        "destination": {
          "kind": "project",
          "projectId": "prj_a1b2c3",
          "scope": "personal"
        },
        "provider": "codex"
      }
    ],
    "updated": 1
  }
}
```
