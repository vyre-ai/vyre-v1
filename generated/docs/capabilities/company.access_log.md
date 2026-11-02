# company.access_log

Who reached whose mail, calendar or files: who made the call, the person an agent worked for, which mailbox, when

| | |
|---|---|
| Module | members |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/company/access_log |
| MCP tool | company_access_log (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
  mailbox?: string;
};
```

## Output

```ts
type Out = {
  entries: Array<{
      who: string;
      onBehalf?: string;
      mailbox: string;
      cap: string;
      at: number;
    }>;
  next?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "mailbox": "maya@example.com"
  },
  "output": {
    "entries": [
      {
        "at": 1760000000000,
        "cap": "example",
        "mailbox": "example",
        "onBehalf": "example",
        "who": "example"
      }
    ],
    "next": "example"
  }
}
```
