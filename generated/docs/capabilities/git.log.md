# git.log

Commit history of the folder, a path or a branch, with authors

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
| HTTP | POST /v1/git/log |
| MCP tool | git_log (files) |
| CLI | vyre git log |
| Emits | none |

## Input

```ts
type In = {
  folderId: string;
  path?: string;
  branch?: string;
  limit?: number;
  before?: string;
};
```

## Output

```ts
type Out = {
  commits: Array<{
      sha: string;
      message: string;
      author: {
        name: string;
        kind: "person" | "agent" | "actor" | "external";
        id?: string;
      };
      at: number;
      files: number;
      parents: Array<string>;
    }>;
  next?: string;
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
    "before": "9fceb02",
    "branch": "main",
    "folderId": "fld_a1b2c3",
    "limit": 1,
    "path": "example"
  },
  "output": {
    "commits": [
      {
        "at": 1760000000000,
        "author": {
          "id": "example",
          "kind": "person",
          "name": "example"
        },
        "files": 1,
        "message": "example",
        "parents": [
          "9fceb02"
        ],
        "sha": "9fceb02"
      }
    ],
    "next": "9fceb02"
  }
}
```
