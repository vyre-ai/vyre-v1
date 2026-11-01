# engine.crew.repo.get

The project's repository for the crew, or nothing when none is set

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/crew/repo/get |
| MCP tool | engine_crew_repo_get (chats) |
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
  repo: {
    projectId: string;
    path: string;
    baseBranch: string;
    branch: string;
  } | null;
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
    "repo": {
      "baseBranch": "example",
      "branch": "example",
      "path": "example",
      "projectId": "prj_a1b2c3"
    }
  }
}
```
