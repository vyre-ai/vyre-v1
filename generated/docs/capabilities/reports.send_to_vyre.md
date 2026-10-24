# reports.send_to_vyre

POST the redacted bundle to reports.vyre.run when policy reports.vyre is On

| | |
|---|---|
| Module | reports-client |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/reports/send_to_vyre |
| MCP tool | none |
| CLI | none |
| Emits | report.sent_to_vyre |

## Input

```ts
type In = {
  reportId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  issueNumber?: number;
  stored: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.network
- provider.unavailable
- rate_limit.exceeded
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "reportId": "rpt_a1b2c3"
  },
  "output": {
    "issueNumber": 1,
    "stored": true
  }
}
```
