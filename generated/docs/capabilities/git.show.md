# git.show

One commit: its files with counts, and the hunks of one path if given (opens as a Diff tab)

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
| HTTP | POST /v1/git/show |
| MCP tool | git_show (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  folderId: string;
  sha: string;
  path?: string;
};
```

## Output

```ts
type Out = {
  commit: {
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
  };
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
    "path": "example",
    "sha": "9fceb02"
  },
  "output": {
    "commit": {
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
    },
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
