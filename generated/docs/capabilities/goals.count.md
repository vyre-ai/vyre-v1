# goals.count

How many goals a project has, whoever may open them: a number and nothing else (never a title). Only a manager of the project or the system may ask; the Overview uses it to say how many goals a reader may not open

| | |
|---|---|
| Module | goals |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/goals/count |
| MCP tool | goals_count (tasks) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId: string;
};
```

## Output

```ts
type Out = {
  count: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "count": 1
  }
}
```
