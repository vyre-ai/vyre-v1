# projects.update.edit

Edit the status update's draft in place

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
| HTTP | POST /v1/projects/update/edit |
| MCP tool | projects_update_edit (records) |
| CLI | none |
| Emits | project.update_drafted |

## Input

```ts
type In = {
  projectId: string;
  text: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "projectId": "prj_a1b2c3",
    "text": "example"
  },
  "output": {
    "at": 1760000000000,
    "by": "example",
    "text": "example"
  }
}
```
