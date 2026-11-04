# projects.post_update

Post the status update (by the lead, or drafted weekly by an agent) to the project channel and keep it on the Overview

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
| HTTP | POST /v1/projects/post_update |
| MCP tool | projects_post_update (records) |
| CLI | none |
| Emits | project.update_posted, record.updated |

## Input

```ts
type In = {
  projectId: string;
  text: string;
  status?: string;
};
```

## Output

```ts
type Out = {
  postedAt: number;
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
    "status": "example",
    "text": "example"
  },
  "output": {
    "postedAt": 1760000000000
  }
}
```
