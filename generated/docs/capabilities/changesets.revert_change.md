# changesets.revert_change

Revert a single change (one hunk or one file) inside a changeset

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/changesets/revert_change |
| MCP tool | changesets_revert_change (files) |
| CLI | none |
| Emits | changeset.updated |

## Input

```ts
type In = {
  changesetId: string;
  path: string;
  hunkId?: string;
};
```

## Output

```ts
type Out = {
  fileCount: number;
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
    "changesetId": "chg_a1b2c3",
    "hunkId": "example",
    "path": "example"
  },
  "output": {
    "fileCount": 1
  }
}
```
