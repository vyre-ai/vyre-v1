# projects.unarchive

Bring an archived project back to the lists

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
| HTTP | POST /v1/projects/unarchive |
| MCP tool | projects_unarchive (records) |
| CLI | none |
| Emits | project.unarchived |

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
