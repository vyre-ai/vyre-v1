# engine.crew.repo.set

Say which folder on this computer holds the project's repository, and the branch teammates start from; the folder must be a git repository

| | |
|---|---|
| Module | engine |
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
| HTTP | POST /v1/engine/crew/repo/set |
| MCP tool | engine_crew_repo_set (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId: string;
  path: string;
  baseBranch?: string;
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
  };
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
    "baseBranch": "main",
    "path": "/Users/maya/code/site",
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
