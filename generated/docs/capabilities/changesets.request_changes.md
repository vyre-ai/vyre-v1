# changesets.request_changes

Send the reviewer comments back to the agent thread and keep the changeset open

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
| HTTP | POST /v1/changesets/request_changes |
| MCP tool | changesets_request_changes (files) |
| CLI | none |
| Emits | changeset.changes_requested |

## Input

```ts
type In = {
  changesetId: string;
  note?: string;
};
```

## Output

```ts
type Out = {
  sent: number;
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
    "note": "example"
  },
  "output": {
    "sent": 1
  }
}
```
