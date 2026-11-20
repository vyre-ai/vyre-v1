# identity.pair_create

A signed-in device makes a short pair code for another device, the extension or the local daemon (valid 10 minutes)

| | |
|---|---|
| Module | identity |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/identity/pair_create |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  purpose: "app" | "phone" | "extension" | "daemon";
  challenge?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  code: string;
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
    "challenge": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "idempotencyKey": "idem_1",
    "purpose": "app"
  },
  "output": {
    "code": "K7P2-9QXA",
    "expiresAt": 1760000000000
  }
}
```
