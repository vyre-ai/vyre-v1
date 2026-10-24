# changesets.approve

Approve and commit a changeset: 3-way merge on the recorded base, conflicts go to the reviewer; optionally push

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | push_protected when input.push == true |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/changesets/approve |
| MCP tool | changesets_approve (files) |
| CLI | none |
| Emits | changeset.approved, file.version_added |

## Input

```ts
type In = {
  changesetId: string;
  message?: string;
  push?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  approved: boolean;
  versionIds: Array<string>;
  commit?: string;
  conflicts: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_approval
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "changesetId": "chg_a1b2c3",
    "idempotencyKey": "idem_1",
    "message": "example",
    "push": true
  },
  "output": {
    "approved": true,
    "commit": "example",
    "conflicts": [
      "example"
    ],
    "versionIds": [
      "ver_a1b2c3"
    ]
  }
}
```
