# mailgun.domains.get

Read one domain with the DNS records to publish

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
| HTTP | POST /v1/mailgun/domains/get |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  name: string;
};
```

## Output

```ts
type Out = {
  domain: {
    name: string;
    state: "unverified" | "active" | "disabled";
    spf: "pass" | "fail" | "pending";
    dkim: "pass" | "fail" | "pending";
    dmarc: "pass" | "fail" | "pending";
    region: "us" | "eu";
  };
  records: Array<{
      purpose: "spf" | "dkim" | "dmarc" | "mx" | "verify";
      type: "TXT" | "CNAME" | "MX";
      name: string;
      value: string;
      state: "pass" | "fail" | "pending";
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
  "input": {
    "name": "example"
  },
  "output": {
    "domain": {
      "dkim": "pass",
      "dmarc": "pass",
      "name": "example",
      "region": "us",
      "spf": "pass",
      "state": "unverified"
    },
    "records": [
      {
        "name": "example",
        "purpose": "spf",
        "state": "pass",
        "type": "TXT",
        "value": "example"
      }
    ]
  }
}
```
