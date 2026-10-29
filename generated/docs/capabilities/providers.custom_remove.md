# providers.custom_remove

Remove a custom endpoint I registered, and my connections to it

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
| HTTP | POST /v1/providers/custom_remove |
| MCP tool | providers_custom_remove (vault) |
| CLI | none |
| Emits | provider.removed, vault.item_deleted |

## Input

```ts
type In = {
  key: string;
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
    "key": "example"
  },
  "output": {
    "ok": true
  }
}
```
