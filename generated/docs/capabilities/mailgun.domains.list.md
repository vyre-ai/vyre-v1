# mailgun.domains.list

List domains in the Mailgun account

| | |
|---|---|
| Module | mailgun |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | comms.domains |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mailgun/domains/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  domains: Array<{
      name: string;
      state: "unverified" | "active" | "disabled";
      spf: "pass" | "fail" | "pending";
      dkim: "pass" | "fail" | "pending";
      dmarc: "pass" | "fail" | "pending";
      region: "us" | "eu";
    }>;
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
  "input": {},
  "output": {
    "domains": [
      {
        "dkim": "pass",
        "dmarc": "pass",
        "name": "example",
        "region": "us",
        "spf": "pass",
        "state": "unverified"
      }
    ]
  }
}
```
