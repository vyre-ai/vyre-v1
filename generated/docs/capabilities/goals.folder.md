# goals.folder

The Files folder of a goal, where its plan, drafts, research and reports go; asking for a subfolder makes it the first time it is needed

| | |
|---|---|
| Module | goals |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/goals/folder |
| MCP tool | goals_folder (tasks) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  goalId: string;
  sub?: "Plan" | "Drafts" | "Research" | "Reports";
};
```

## Output

```ts
type Out = {
  folderId: string;
  path: string;
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
    "goalId": "gol_a1b2c3",
    "sub": "Plan"
  },
  "output": {
    "folderId": "fld_a1b2c3",
    "path": "example"
  }
}
```
