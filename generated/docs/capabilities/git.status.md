# git.status

Branch, ahead and behind counts, changed files, remotes and whether the branch is protected

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
| HTTP | POST /v1/git/status |
| MCP tool | git_status (files) |
| CLI | vyre git status |
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
  isRepo: boolean;
  branch?: string;
  upstream?: string;
  head?: string;
  ahead: number;
  behind: number;
  clean: boolean;
  changes: Array<{
      path: string;
      status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
      added: number;
      removed: number;
      staged: boolean;
    }>;
  remotes: Array<{
      name: string;
      url: string;
    }>;
  protected: boolean;
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
    "ahead": 1,
    "behind": 1,
    "branch": "main",
    "changes": [
      {
        "added": 1,
        "path": "example",
        "removed": 1,
        "staged": true,
        "status": "added"
      }
    ],
    "clean": true,
    "head": "9fceb02",
    "isRepo": true,
    "protected": true,
    "remotes": [
      {
        "name": "origin",
        "url": "https://github.com/vyre-ai/website.git"
      }
    ],
    "upstream": "example"
  }
}
```
