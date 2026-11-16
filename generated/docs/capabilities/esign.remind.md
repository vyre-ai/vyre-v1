# esign.remind

New link for a signer; the old one stops

| | |
|---|---|
| Module | esign |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.shared_send |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | signature_send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/esign/remind |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  envelopeId: string;
  signer: number;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  link?: {
    index: number;
    name: string;
    email?: string;
    url?: string;
    path?: string;
  };
  emailed: boolean;
  notice?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "envelopeId": "env_a1b2c3",
    "idempotencyKey": "idem_1",
    "signer": 1
  },
  "output": {
    "emailed": true,
    "link": {
      "email": "example",
      "index": 1,
      "name": "example",
      "path": "example",
      "url": "example"
    },
    "notice": "example"
  }
}
```
