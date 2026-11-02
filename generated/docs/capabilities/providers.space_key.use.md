# providers.space_key.use

System: the engine asks to run one turn on the Space AI key for the person it acts for. Answers the handle, never the value; each use is an audit row

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/providers/space_key/use |
| MCP tool | none |
| CLI | none |
| Emits | vault.used |

## Input

```ts
type In = {
  handle: string;
};
```

## Output

```ts
type Out = {
  handle: string;
  itemId: string;
};
```

## Errors

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
    "handle": "#Dana_Lawmatics.api_key"
  },
  "output": {
    "handle": "#Dana_Lawmatics",
    "itemId": "vit_a1b2c3"
  }
}
```
