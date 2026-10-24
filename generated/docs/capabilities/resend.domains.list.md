# resend.domains.list

List domains in the Resend account

| | |
|---|---|
| Module | resend |
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
| HTTP | POST /v1/resend/domains/list |
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
      providerDomainId: string;
      name: string;
      status: "not_started" | "pending" | "verified" | "failed";
      spf: "pass" | "fail" | "pending";
      dkim: "pass" | "fail" | "pending";
      dmarc: "pass" | "fail" | "pending";
      region?: string;
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
        "providerDomainId": "example",
        "region": "example",
        "spf": "pass",
        "status": "not_started"
      }
    ]
  }
}
```
