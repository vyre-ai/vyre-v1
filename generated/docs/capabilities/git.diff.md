# git.diff

Working-copy changes against HEAD, or between two commits or branches

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
| HTTP | POST /v1/git/diff |
| MCP tool | git_diff (files) |
| CLI | vyre git diff |
| Emits | none |

## Input

```ts
type In = {
  folderId: string;
  from?: string;
  to?: string;
  path?: string;
};
```

## Output

```ts
type Out = {
  files: Array<{
      path: string;
      status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
      added: number;
      removed: number;
      staged: boolean;
    }>;
  hunks: Array<{
      hunkId: string;
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: Array<{
          op: "ctx" | "add" | "del";
          text: string;
        }>;
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
    "folderId": "fld_a1b2c3",
    "from": "example",
    "path": "example",
    "to": "example"
  },
  "output": {
    "files": [
      {
        "added": 1,
        "path": "example",
        "removed": 1,
        "staged": true,
        "status": "added"
      }
    ],
    "hunks": [
      {
        "hunkId": "example",
        "lines": [
          {
            "op": "ctx",
            "text": "example"
          }
        ],
        "newLines": 1,
        "newStart": 1,
        "oldLines": 1,
        "oldStart": 1
      }
    ]
  }
}
```
