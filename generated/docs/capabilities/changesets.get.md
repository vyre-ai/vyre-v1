# changesets.get

Read a changeset with its file list and counts

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/changesets/get |
| MCP tool | changesets_get (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  changesetId: string;
};
```

## Output

```ts
type Out = {
  changeset: {
    changesetId: string;
    folderId: string;
    state: "open" | "changes_requested" | "approved" | "discarded";
    by: string;
    onBehalfOf?: string;
    baseVersion?: string;
    fileCount: number;
    added: number;
    removed: number;
    openedAt: number;
    reviewer?: string;
    threadId?: string;
    pushPending: boolean;
  };
  files: Array<{
      path: string;
      status: "added" | "modified" | "deleted" | "renamed";
      added: number;
      removed: number;
      conflict: boolean;
    }>;
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
    "changesetId": "chg_a1b2c3"
  },
  "output": {
    "changeset": {
      "added": 1,
      "baseVersion": "example",
      "by": "example",
      "changesetId": "chg_a1b2c3",
      "fileCount": 1,
      "folderId": "fld_a1b2c3",
      "onBehalfOf": "example",
      "openedAt": 1760000000000,
      "pushPending": true,
      "removed": 1,
      "reviewer": "example",
      "state": "open",
      "threadId": "thr_a1b2c3"
    },
    "files": [
      {
        "added": 1,
        "conflict": true,
        "path": "example",
        "removed": 1,
        "status": "added"
      }
    ]
  }
}
```
