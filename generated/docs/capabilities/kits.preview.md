# kits.preview

Preview a Kit before applying it

| | |
|---|---|
| Module | kits |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | kit (/kitId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/kits/preview |
| MCP tool | kits_preview (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kitId: string;
};
```

## Output

```ts
type Out = {
  changes: Array<{
      kind: string;
      title: string;
    }>;
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
    "kitId": "kit_a1b2c3"
  },
  "output": {
    "changes": [
      {
        "kind": "example",
        "title": "example"
      }
    ]
  }
}
```
