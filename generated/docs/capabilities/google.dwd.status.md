# google.dwd.status

State of domain-wide delegation: key stored, scopes, last probe, mapped members

| | |
|---|---|
| Module | google |
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
| HTTP | POST /v1/google/dwd/status |
| MCP tool | google_dwd_status (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  configured: boolean;
  adminEmail?: string;
  domain?: string;
  lastProbeAt?: number;
  lastProbeOk?: boolean;
  autoConnect: boolean;
  mappedMembers: number;
  excluded: Array<string>;
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
    "adminEmail": "maya@example.com",
    "autoConnect": true,
    "configured": true,
    "domain": "example",
    "excluded": [
      "maya@example.com"
    ],
    "lastProbeAt": 1760000000000,
    "lastProbeOk": true,
    "mappedMembers": 1
  }
}
```
