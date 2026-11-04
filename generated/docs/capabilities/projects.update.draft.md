# projects.update.draft

Draft the status update again from the project facts, on the asker's own AI account; it is kept as the draft and posted only by Post

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
| HTTP | POST /v1/projects/update/draft |
| MCP tool | projects_update_draft (records) |
| CLI | none |
| Emits | project.update_drafted |

## Input

```ts
type In = {
  projectId: string;
};
```

## Output

```ts
type Out = {
  text: string;
  at: number;
  by: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.unavailable
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "at": 1760000000000,
    "by": "example",
    "text": "example"
  }
}
```
