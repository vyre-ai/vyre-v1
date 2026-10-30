# engine.complete

One request and one answer on an account the caller can run on, for work that is not a chat (memory upkeep); returns the text and the token counts and posts nothing

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/complete |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  accountRef: string;
  prompt: string;
  system?: string;
  model?: string;
};
```

## Output

```ts
type Out = {
  text: string;
  tokensIn: number;
  tokensOut: number;
};
```

## Errors

- internal.unavailable
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "accountRef": "example",
    "model": "example",
    "prompt": "example",
    "system": "example"
  },
  "output": {
    "text": "example",
    "tokensIn": 1,
    "tokensOut": 1
  }
}
```
