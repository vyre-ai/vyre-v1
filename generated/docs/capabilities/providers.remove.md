# providers.remove

Remove a provider and its key or sign-in

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/providers/remove |
| MCP tool | providers_remove (vault) |
| CLI | none |
| Emits | provider.removed, vault.item_deleted |

## Input

```ts
type In = {
  providerId: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "providerId": "prv_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
