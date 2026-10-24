# changesets.list

List changesets, for example the ones waiting for me

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
| HTTP | POST /v1/changesets/list |
| MCP tool | changesets_list (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  folderId?: string;
  state?: "open" | "changes_requested" | "approved" | "discarded";
  mine?: boolean;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  changesets: Array<{
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
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "folderId": "fld_a1b2c3",
    "limit": 1,
    "mine": true,
    "state": "open"
  },
  "output": {
    "changesets": [
      {
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
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
