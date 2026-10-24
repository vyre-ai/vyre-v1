# search.embed.run

Embeddings consumer: compute pending vectors with the small local model (384 dimensions)

| | |
|---|---|
| Module | search |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/search/embed/run |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  limit?: number;
};
```

## Output

```ts
type Out = {
  embedded: number;
  pending: number;
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
    "limit": 1
  },
  "output": {
    "embedded": 1,
    "pending": 1
  }
}
```
