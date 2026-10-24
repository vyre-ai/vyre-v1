# projects.file_chat

File a private chat under the project; it stays private and the agent gets the project memory and folder

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/file_chat |
| MCP tool | projects_file_chat (records) |
| CLI | none |
| Emits | project.chat_filed |

## Input

```ts
type In = {
  projectId: string;
  threadId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "projectId": "prj_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
