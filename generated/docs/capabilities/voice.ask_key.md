# voice.ask_key

Post the secret card that asks for a Talk key in this chat: their own, or the Space's. The value goes straight to the Vault and never into the chat

| | |
|---|---|
| Module | voice |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/voice/ask_key |
| MCP tool | voice_ask_key (meta, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope?: "mine" | "space";
  provider?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "provider": "deepgram",
    "scope": "mine"
  },
  "output": {
    "ok": true
  }
}
```
