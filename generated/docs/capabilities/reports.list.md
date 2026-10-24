# reports.list

List problem reports and their state

| | |
|---|---|
| Module | reports-client |
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
| HTTP | POST /v1/reports/list |
| MCP tool | reports_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  reports: Array<{
      reportId: string;
      title: string;
      status: string;
      at: number;
      issueNumber?: number;
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
    "limit": 1
  },
  "output": {
    "next": "example",
    "reports": [
      {
        "at": 1760000000000,
        "issueNumber": 1,
        "reportId": "rpt_a1b2c3",
        "status": "example",
        "title": "example"
      }
    ],
    "total": 1
  }
}
```
