# network.domain_set

Set the Space address to an own domain (DNS check, then ACME)

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.network |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/network/domain_set |
| MCP tool | network_domain_set (engineer) |
| CLI | none |
| Emits | network.domain_changed |

## Input

```ts
type In = {
  domain: string;
};
```

## Output

```ts
type Out = {
  dnsOk: boolean;
  records: Array<{
      type: string;
      name: string;
      value: string;
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
    "domain": "space.example.com"
  },
  "output": {
    "dnsOk": true,
    "records": [
      {
        "name": "example",
        "type": "example",
        "value": "example"
      }
    ]
  }
}
```
