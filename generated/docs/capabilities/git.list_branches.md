# git.list_branches

Branches and remote branches for the branch picker

| | |
|---|---|
| Module | git |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | folder (/folderId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/git/list_branches |
| MCP tool | git_list_branches (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  folderId: string;
};
```

## Output

```ts
type Out = {
  current?: string;
  branches: Array<{
      name: string;
      remote: boolean;
      sha: string;
      protected: boolean;
      ahead?: number;
      behind?: number;
    }>;
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
    "folderId": "fld_a1b2c3"
  },
  "output": {
    "branches": [
      {
        "ahead": 1,
        "behind": 1,
        "name": "main",
        "protected": true,
        "remote": true,
        "sha": "9fceb02"
      }
    ],
    "current": "main"
  }
}
```
