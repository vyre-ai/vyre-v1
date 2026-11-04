# projects.archive

Archive a project: it leaves the lists and stays readable, with its record, channel, folder and plan. A manager of the project

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/projects/archive |
| MCP tool | projects_archive (records) |
| CLI | none |
| Emits | project.archived |

## Input

```ts
type In = {
  projectId: string;
};
```

## Output

```ts
type Out = {
  archived: boolean;
  changed: boolean;
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
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "archived": true,
    "changed": true
  }
}
```
