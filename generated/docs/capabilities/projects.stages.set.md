# projects.stages.set

Create, rename, reorder or remove the stages of a plan

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
| HTTP | POST /v1/projects/stages/set |
| MCP tool | projects_stages_set (tasks) |
| CLI | none |
| Emits | project.stages_changed, record.updated |

## Input

```ts
type In = {
  projectId: string;
  stages: Array<{
      key?: string;
      title: string;
    }>;
};
```

## Output

```ts
type Out = {
  stages: Array<{
      key: string;
      title: string;
      order: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "projectId": "prj_a1b2c3",
    "stages": [
      {
        "key": "draft",
        "title": "example"
      }
    ]
  },
  "output": {
    "stages": [
      {
        "key": "draft",
        "order": 1,
        "title": "example"
      }
    ]
  }
}
```
