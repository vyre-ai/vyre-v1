# changesets.edit

Edit a proposed change in place before accepting it: replace a run of lines in one staged file. The proposer stays recorded and so does the editor; Approve still goes through its own Gate

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/changesets/edit |
| MCP tool | changesets_edit (files) |
| CLI | none |
| Emits | changeset.edited |

## Input

```ts
type In = {
  changesetId: string;
  path: string;
  startLine: number;
  removeLines: number;
  lines: Array<string>;
};
```

## Output

```ts
type Out = {
  fileCount: number;
  added: number;
  removed: number;
  proposedBy: string;
  editedBy: string;
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
    "changesetId": "chg_a1b2c3",
    "lines": [
      "example"
    ],
    "path": "example",
    "removeLines": 1,
    "startLine": 1
  },
  "output": {
    "added": 1,
    "editedBy": "example",
    "fileCount": 1,
    "proposedBy": "example",
    "removed": 1
  }
}
```
