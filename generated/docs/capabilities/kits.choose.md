# kits.choose

Choose the Kit for the Space or for yourself

| | |
|---|---|
| Module | kits |
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
| HTTP | POST /v1/kits/choose |
| MCP tool | kits_choose (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kitId: string;
  scope: "space" | "person";
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
    "kitId": "kit_a1b2c3",
    "scope": "space"
  },
  "output": {
    "ok": true
  }
}
```
