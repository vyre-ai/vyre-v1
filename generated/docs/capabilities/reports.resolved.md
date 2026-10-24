# reports.resolved

Inbound: the reporter Space is told the issue closed (webhook from reports.vyre.run)

| | |
|---|---|
| Module | reports-client |
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
| HTTP | POST /hooks/reports |
| MCP tool | none |
| CLI | none |
| Emits | report.resolved |

## Input

```ts
type In = {
  reportId: string;
  issueNumber: number;
  fixedIn?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "fixedIn": "example",
    "issueNumber": 1,
    "reportId": "rpt_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
