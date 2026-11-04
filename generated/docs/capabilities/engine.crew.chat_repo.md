# engine.crew.chat_repo

The repository of a chat that has its own work folder for the crew, or nothing yet

| | |
|---|---|
| Module | engine |
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
| HTTP | POST /v1/engine/crew/chat_repo |
| MCP tool | engine_crew_chat_repo (chats) |
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
  repo: {
    projectId?: string;
    threadId?: string;
    path: string;
    baseBranch: string;
    branch: string;
  } | null;
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
    "repo": {
      "baseBranch": "example",
      "branch": "example",
      "path": "example",
      "projectId": "prj_a1b2c3",
      "threadId": "thr_a1b2c3"
    }
  }
}
```
