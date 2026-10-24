# projects.unpin_file

Unpin a file from the Overview

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
| HTTP | POST /v1/projects/unpin_file |
| MCP tool | projects_unpin_file (records) |
| CLI | none |
| Emits | project.file_unpinned, record.updated |

## Input

```ts
type In = {
  projectId: string;
  fileId: string;
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
    "fileId": "fil_a1b2c3",
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
