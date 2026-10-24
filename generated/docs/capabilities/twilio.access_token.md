# twilio.access_token

Mint a short-lived Voice JS SDK access token (the softphone asks telephony.voice_token, which calls this)

| | |
|---|---|
| Module | twilio |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/twilio/access_token |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  identity: string;
  ttlSec?: number;
};
```

## Output

```ts
type Out = {
  token: string;
  expiresAt: number;
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
    "identity": "example",
    "ttlSec": 60
  },
  "output": {
    "expiresAt": 1760000000000,
    "token": "example"
  }
}
```
