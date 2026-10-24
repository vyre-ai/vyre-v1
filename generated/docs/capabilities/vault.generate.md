# vault.generate

Make a password, passphrase or token; the result is a fresh value that is not stored

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/vault/generate |
| MCP tool | vault_generate (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind: "password" | "passphrase" | "token";
  length?: number;
  symbols?: boolean;
  words?: number;
};
```

## Output

```ts
type Out = {
  value: string;
  strength: "fair" | "good" | "strong";
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
    "kind": "password",
    "length": 8,
    "symbols": true,
    "words": 3
  },
  "output": {
    "strength": "fair",
    "value": "example"
  }
}
```
