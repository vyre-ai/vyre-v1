# telephony.voice_token

Mint a short-lived Voice SDK token for the softphone (TwiML app per Space)

| | |
|---|---|
| Module | telephony |
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
| HTTP | POST /v1/telephony/voice_token |
| MCP tool | telephony_voice_token (inbox, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  numberId?: string;
};
```

## Output

```ts
type Out = {
  token: string;
  identity: string;
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
    "numberId": "num_a1b2c3"
  },
  "output": {
    "expiresAt": 1760000000000,
    "identity": "example",
    "token": "example"
  }
}
```
