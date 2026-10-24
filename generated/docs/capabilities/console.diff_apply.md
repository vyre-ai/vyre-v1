# console.diff_apply

Apply a proposed change as the person, with on-behalf-of audit; fixes target Space-owned objects as changesets approved by their Manage holders

| | |
|---|---|
| Module | console-assistant |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | console.access |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/console/diff_apply |
| MCP tool | console_diff_apply (engineer) |
| CLI | none |
| Emits | console.change_applied |

## Input

```ts
type In = {
  diffId: string;
};
```

## Output

```ts
type Out = {
  applied: boolean;
  changesetId?: string;
  auditId?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "diffId": "dif_a1b2c3"
  },
  "output": {
    "applied": true,
    "auditId": "example",
    "changesetId": "chg_a1b2c3"
  }
}
```
